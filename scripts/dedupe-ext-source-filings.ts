/**
 * Dedupe ExtSource rows for annual filings (10-K / 20-F / 40-F).
 *
 * Problem
 * -------
 * The same SEC filing can appear multiple times in the ext_source table:
 *   - Legacy ingest wrote `kind=10k` for foreign filers that are actually 20-F.
 *   - There is no unique constraint on (filerEntityId, accessionNumber).
 *   - Some import runs re-inserted rows instead of reusing them.
 *
 * Result on the company page: 2025 Q4 · 20-F shows up 3 times for PDD,
 * Toyota shows 4–7 duplicate rows per year, etc.
 *
 * Strategy
 * --------
 * Group annual-filing ExtSource rows by (filerEntityId, accessionNumber).
 * Within each group:
 *   1. Pick a "winner" row:
 *      a) Prefer the row whose `kind` matches metadata.form (20f > 40f > 10k).
 *      b) Otherwise prefer kind 20f, then 40f, then 10k.
 *      c) Then prefer the row with the most attached children (sections,
 *         financials, attachments, artifacts).
 *      d) Then most recent id (cuid is roughly time-ordered).
 *   2. Reparent every loser row's children (Financial, FilingSection,
 *      FilingAttachment, FilingArtifact, Holding) onto the winner's id. When
 *      a unique constraint would be violated, drop the loser's child row
 *      (the winner's row wins, since the data is identical).
 *   3. Delete the loser rows.
 *   4. If the winner's `kind` disagrees with its metadata.form, fix kind.
 *
 * Also fixes "non-duplicate but wrong-kind" rows: e.g. metadata.form=20-F
 * but kind=10k with no peer row. We just update `kind` to match the form.
 *
 * Run with --apply to commit. Without --apply, prints a plan only.
 */

import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const FILER_ARG = (() => {
  const i = process.argv.indexOf("--filer");
  return i >= 0 ? process.argv[i + 1]?.trim() ?? null : null;
})();

type Counts = {
  attachments: number;
  artifacts: number;
  financials: number;
  holdings: number;
  sections: number;
};

type Row = {
  id: string;
  kind: string;
  filerEntityId: string | null;
  metadata: Prisma.JsonValue;
  filerName: string;
  counts: Counts;
};

function getMetaString(metadata: Prisma.JsonValue, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function getAccession(metadata: Prisma.JsonValue): string | null {
  return getMetaString(metadata, "accessionNumber") ?? getMetaString(metadata, "accession");
}

function normalizeForm(form: string | null): "20f" | "40f" | "10k" | null {
  if (!form) return null;
  const f = form.trim().toLowerCase().replace(/[-/]/g, "");
  if (f === "20f" || f === "20fa") return "20f";
  if (f === "40f" || f === "40fa") return "40f";
  if (f === "10k" || f === "10ka") return "10k";
  return null;
}

function kindRank(kind: string): number {
  return kind === "20f" ? 0 : kind === "40f" ? 1 : kind === "10k" ? 2 : 99;
}

function totalChildren(c: Counts): number {
  return c.attachments + c.artifacts + c.financials + c.holdings + c.sections;
}

function pickWinner(rows: Row[]): Row {
  return [...rows].sort((a, b) => {
    const aForm = normalizeForm(getMetaString(a.metadata, "form"));
    const bForm = normalizeForm(getMetaString(b.metadata, "form"));
    const aMatches = aForm && aForm === a.kind ? 0 : 1;
    const bMatches = bForm && bForm === b.kind ? 0 : 1;
    if (aMatches !== bMatches) return aMatches - bMatches;

    const ar = kindRank(a.kind);
    const br = kindRank(b.kind);
    if (ar !== br) return ar - br;

    const af = totalChildren(a.counts);
    const bf = totalChildren(b.counts);
    if (af !== bf) return bf - af;

    return b.id.localeCompare(a.id);
  })[0];
}

async function loadAllRows(): Promise<Row[]> {
  const filerWhere = FILER_ARG
    ? {
        filer: {
          OR: [
            { id: FILER_ARG },
            { cik: FILER_ARG },
            { ticker: { equals: FILER_ARG, mode: Prisma.QueryMode.insensitive } },
            { canonicalName: { contains: FILER_ARG, mode: Prisma.QueryMode.insensitive } },
          ],
        },
      }
    : {};
  const rows = await db.extSource.findMany({
    where: { kind: { in: ["10k", "20f", "40f"] }, ...filerWhere },
    select: {
      id: true,
      kind: true,
      filerEntityId: true,
      metadata: true,
      filer: { select: { canonicalName: true } },
      _count: {
        select: {
          attachments: true,
          artifacts: true,
          financials: true,
          holdings: true,
          sections: true,
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    filerEntityId: r.filerEntityId,
    metadata: r.metadata as Prisma.JsonValue,
    filerName: r.filer?.canonicalName ?? "?",
    counts: r._count,
  }));
}

type Plan = {
  duplicateGroups: Array<{ filerName: string; accession: string; winner: Row; losers: Row[] }>;
  kindFixes: Array<{ row: Row; from: string; to: string }>;
  noAccession: Row[];
};

function buildPlan(rows: Row[]): Plan {
  const buckets = new Map<string, Row[]>();
  const noAccession: Row[] = [];
  for (const r of rows) {
    if (!r.filerEntityId) continue;
    const acc = getAccession(r.metadata);
    if (!acc) {
      noAccession.push(r);
      continue;
    }
    const key = `${r.filerEntityId}|${acc}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r);
    else buckets.set(key, [r]);
  }

  const duplicateGroups: Plan["duplicateGroups"] = [];
  const kindFixes: Plan["kindFixes"] = [];

  for (const [key, group] of buckets.entries()) {
    const accession = key.split("|").slice(1).join("|");
    const winner = pickWinner(group);
    const losers = group.filter((r) => r.id !== winner.id);
    if (losers.length) {
      duplicateGroups.push({ filerName: winner.filerName, accession, winner, losers });
    }
    // Whether duplicate or not, normalize winner's kind to match metadata.form.
    const winnerForm = normalizeForm(getMetaString(winner.metadata, "form"));
    if (winnerForm && winnerForm !== winner.kind) {
      kindFixes.push({ row: winner, from: winner.kind, to: winnerForm });
    }
  }

  return { duplicateGroups, kindFixes, noAccession };
}

function summarizePlan(plan: Plan) {
  console.log(`\n=== plan summary ===`);
  console.log(`duplicate groups:        ${plan.duplicateGroups.length}`);
  const totalLosers = plan.duplicateGroups.reduce((n, g) => n + g.losers.length, 0);
  console.log(`rows to delete (losers): ${totalLosers}`);
  const reparentTotals = { attachments: 0, artifacts: 0, financials: 0, holdings: 0, sections: 0 };
  for (const g of plan.duplicateGroups) {
    for (const l of g.losers) {
      reparentTotals.attachments += l.counts.attachments;
      reparentTotals.artifacts += l.counts.artifacts;
      reparentTotals.financials += l.counts.financials;
      reparentTotals.holdings += l.counts.holdings;
      reparentTotals.sections += l.counts.sections;
    }
  }
  console.log(`children needing reparent:`);
  console.log(`  financials=${reparentTotals.financials} holdings=${reparentTotals.holdings} sections=${reparentTotals.sections}`);
  console.log(`  attachments=${reparentTotals.attachments} artifacts=${reparentTotals.artifacts}`);
  console.log(`kind-only fixes:         ${plan.kindFixes.length}`);
  console.log(`rows without accession:  ${plan.noAccession.length}`);

  const shape = new Map<string, number>();
  for (const g of plan.duplicateGroups) {
    const s = [g.winner, ...g.losers]
      .map((r) => r.kind)
      .sort()
      .join("+");
    shape.set(s, (shape.get(s) ?? 0) + 1);
  }
  if (shape.size) {
    console.log(`\nduplicate group shapes:`);
    for (const [s, n] of [...shape.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${s}: ${n}`);
    }
  }

  if (VERBOSE) {
    console.log(`\n--- duplicate group detail ---`);
    for (const g of plan.duplicateGroups) {
      console.log(`\n${g.filerName}  accession=${g.accession}`);
      console.log(`  WIN  ${g.winner.id} kind=${g.winner.kind} form=${getMetaString(g.winner.metadata, "form") ?? "?"} children=${totalChildren(g.winner.counts)}`);
      for (const l of g.losers) {
        console.log(`  loss ${l.id} kind=${l.kind} form=${getMetaString(l.metadata, "form") ?? "?"} children=${totalChildren(l.counts)}`);
      }
    }
  }
}

/**
 * Reparent every child of `loserId` onto `winnerId` inside the given tx.
 *
 * For tables with a unique constraint that does NOT include sourceId we must
 * check for collisions before update. The only such constraint among the
 * children that actually appears in this dataset is Financial's
 * (entityId, periodEnd, periodType, lineItem). Holdings has
 * (holderEntityId, securityId, asOfDate) — in practice losers carry 0 holdings
 * but we handle it defensively.
 *
 * FilingSection.(sourceId, section), FilingArtifact.objectKey (global), and
 * FilingAttachment have no clashing sourceId-less unique → bulk updateMany
 * is safe.
 */
async function reparentChildren(
  tx: Prisma.TransactionClient,
  loserId: string,
  winnerId: string,
): Promise<{ moved: Counts; droppedDueToCollision: Counts }> {
  const moved: Counts = { attachments: 0, artifacts: 0, financials: 0, holdings: 0, sections: 0 };
  const dropped: Counts = { attachments: 0, artifacts: 0, financials: 0, holdings: 0, sections: 0 };

  // 1. Financial — has (entityId, periodEnd, periodType, lineItem) unique.
  const loserFinancials = await tx.financial.findMany({
    where: { sourceId: loserId },
    select: { id: true, entityId: true, periodEnd: true, periodType: true, lineItem: true },
  });
  for (const f of loserFinancials) {
    const clash = await tx.financial.findFirst({
      where: {
        sourceId: winnerId,
        entityId: f.entityId,
        periodEnd: f.periodEnd,
        periodType: f.periodType,
        lineItem: f.lineItem,
      },
      select: { id: true },
    });
    if (clash) {
      await tx.financial.delete({ where: { id: f.id } });
      dropped.financials++;
    } else {
      await tx.financial.update({ where: { id: f.id }, data: { sourceId: winnerId } });
      moved.financials++;
    }
  }

  // 2. Holding — has (holderEntityId, securityId, asOfDate) unique.
  const loserHoldings = await tx.holding.findMany({
    where: { sourceId: loserId },
    select: { id: true, holderEntityId: true, securityId: true, asOfDate: true },
  });
  for (const h of loserHoldings) {
    const clash = await tx.holding.findFirst({
      where: {
        sourceId: winnerId,
        holderEntityId: h.holderEntityId,
        securityId: h.securityId,
        asOfDate: h.asOfDate,
      },
      select: { id: true },
    });
    if (clash) {
      await tx.holding.delete({ where: { id: h.id } });
      dropped.holdings++;
    } else {
      await tx.holding.update({ where: { id: h.id }, data: { sourceId: winnerId } });
      moved.holdings++;
    }
  }

  // 3. FilingSection — (sourceId, section) unique. Same section under same sourceId can't double-exist; loser/winner each have their own scope, but if both point to the same section name we should keep winner's.
  const loserSections = await tx.filingSection.findMany({
    where: { sourceId: loserId },
    select: { id: true, section: true },
  });
  for (const s of loserSections) {
    const clash = await tx.filingSection.findFirst({
      where: { sourceId: winnerId, section: s.section },
      select: { id: true },
    });
    if (clash) {
      await tx.filingSection.delete({ where: { id: s.id } });
      dropped.sections++;
    } else {
      await tx.filingSection.update({ where: { id: s.id }, data: { sourceId: winnerId } });
      moved.sections++;
    }
  }

  // 4. FilingAttachment — no problematic unique.
  const attResult = await tx.filingAttachment.updateMany({ where: { sourceId: loserId }, data: { sourceId: winnerId } });
  moved.attachments = attResult.count;

  // 5. FilingArtifact — objectKey is globally unique, but doesn't conflict on reparent. Bulk safe.
  const artResult = await tx.filingArtifact.updateMany({ where: { sourceId: loserId }, data: { sourceId: winnerId } });
  moved.artifacts = artResult.count;

  return { moved, droppedDueToCollision: dropped };
}

async function applyPlan(plan: Plan) {
  let groupsMerged = 0;
  let losersDeleted = 0;
  const movedTotals: Counts = { attachments: 0, artifacts: 0, financials: 0, holdings: 0, sections: 0 };
  const droppedTotals: Counts = { attachments: 0, artifacts: 0, financials: 0, holdings: 0, sections: 0 };
  let kindFixed = 0;

  for (const g of plan.duplicateGroups) {
    await db.$transaction(
      async (tx) => {
        for (const loser of g.losers) {
          const { moved, droppedDueToCollision } = await reparentChildren(tx, loser.id, g.winner.id);
          (Object.keys(moved) as Array<keyof Counts>).forEach((k) => {
            movedTotals[k] += moved[k];
            droppedTotals[k] += droppedDueToCollision[k];
          });
          await tx.extSource.delete({ where: { id: loser.id } });
          losersDeleted++;
        }
        const winnerForm = normalizeForm(getMetaString(g.winner.metadata, "form"));
        if (winnerForm && winnerForm !== g.winner.kind) {
          await tx.extSource.update({ where: { id: g.winner.id }, data: { kind: winnerForm } });
          kindFixed++;
        }
      },
      { timeout: 60_000 },
    );
    groupsMerged++;
    if (groupsMerged % 10 === 0) {
      console.log(`merged ${groupsMerged}/${plan.duplicateGroups.length} groups…`);
    }
  }

  // Non-duplicate kind-only fixes (winner already covered above when it was part of a dup group).
  const dupWinnerIds = new Set(plan.duplicateGroups.map((g) => g.winner.id));
  for (const fix of plan.kindFixes) {
    if (dupWinnerIds.has(fix.row.id)) continue;
    await db.extSource.update({ where: { id: fix.row.id }, data: { kind: fix.to } });
    kindFixed++;
  }

  console.log(`\n=== apply summary ===`);
  console.log(`groups merged:           ${groupsMerged}`);
  console.log(`rows deleted:            ${losersDeleted}`);
  console.log(`kind fields normalized:  ${kindFixed}`);
  console.log(`children reparented:     ${JSON.stringify(movedTotals)}`);
  console.log(`children dropped (clash):${JSON.stringify(droppedTotals)}`);
}

async function main() {
  console.log(`loading rows… (mode: ${APPLY ? "APPLY" : "DRY-RUN"})`);
  const rows = await loadAllRows();
  console.log(`loaded ${rows.length} annual-filing ExtSource rows`);

  const plan = buildPlan(rows);
  summarizePlan(plan);

  if (!APPLY) {
    console.log(`\nDRY-RUN. Re-run with --apply to commit changes.`);
    return;
  }
  await applyPlan(plan);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
