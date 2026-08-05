/**
 * Registration primitive for onboarding a new Alpha investor: a DB write to
 * the `Filer` table (curated presentation fields consumed by
 * src/lib/tribe.ts, plus filerCik consumed by the 13F/13D-G import scripts
 * via getTrackedFilers()) — this single write is what makes a new investor
 * appear site-wide immediately *and* get picked up by future quarterly
 * reimports, with no code change or redeploy required.
 *
 * Idempotent: if the investor is already registered, it's left untouched
 * and the function reports it as already present.
 */
import prisma from "@/lib/prisma";
import { upsertFilerEntity } from "./13f-import-core";

export type AlphaInvestorInput = {
  id: string;
  name: string;
  nameZh: string;
  firm: string;
  cik: string;
  initials: string;
  materialLabel: string;
  materialSub: string;
};

export async function registerTribeMember(input: AlphaInvestorInput): Promise<"inserted" | "already_present"> {
  const existing = await prisma.filer.findUnique({
    where: { tribeId: input.id },
    select: { personNameEn: true },
  });
  if (existing?.personNameEn) return "already_present";

  // Entity(type=master) + a bare Filer row don't exist yet at this point in
  // the onboarding pipeline (they're normally created by the import:13f
  // step that runs after this one) — upsertFilerEntity creates that
  // skeleton so the curated-field update below has a row to write onto.
  await upsertFilerEntity({ tribeId: input.id, name: input.firm, cik: input.cik });

  await prisma.filer.update({
    where: { tribeId: input.id },
    data: {
      isMasterPersona: false, // this onboarding pipeline is alpha-only by construction
      personNameEn: input.name,
      personNameZh: input.nameZh,
      initials: input.initials,
      materialLabel: input.materialLabel,
      materialSub: input.materialSub,
    },
  });
  return "inserted";
}

export async function isTribeMemberRegistered(id: string): Promise<boolean> {
  const filer = await prisma.filer.findUnique({
    where: { tribeId: id },
    select: { personNameEn: true },
  });
  return filer?.personNameEn != null;
}
