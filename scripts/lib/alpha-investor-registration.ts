/**
 * Registration primitives for onboarding a new Alpha investor:
 *   - registerFiler: file-editing insert into FILERS in
 *     scripts/lib/13f-import-core.ts — drives which CIKs `import:13f` pulls.
 *     Kept as a source-file edit deliberately: it's operator config for a
 *     manually-invoked CLI script, not something that blocks the website
 *     from showing a new investor, so there's no benefit to moving it to
 *     the DB.
 *   - registerTribeMember: DB write to the `Filer` table (curated
 *     presentation fields consumed by src/lib/tribe.ts) — this is what
 *     makes a new investor appear site-wide immediately, no code change or
 *     redeploy required.
 *
 * Both are idempotent: if an entry for the given id already exists, it's
 * left untouched and the function reports it as already present.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { upsertFilerEntity } from "./13f-import-core";

const FILERS_FILE = path.join(process.cwd(), "scripts", "lib", "13f-import-core.ts");
const FILERS_CLOSE = "] as const;";

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

function escapeForDoubleQuotedString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function registerFiler(input: AlphaInvestorInput): Promise<"inserted" | "already_present"> {
  const source = await readFile(FILERS_FILE, "utf8");
  if (source.includes(`tribeId: "${input.id}"`)) return "already_present";

  const closeIndex = source.lastIndexOf(FILERS_CLOSE);
  if (closeIndex === -1) throw new Error(`Could not find "${FILERS_CLOSE}" in ${FILERS_FILE}`);

  const line = `  { tribeId: "${input.id}", name: "${escapeForDoubleQuotedString(input.firm)}", cik: "${input.cik}" },\n`;
  const updated = source.slice(0, closeIndex) + line + source.slice(closeIndex);
  await writeFile(FILERS_FILE, updated, "utf8");
  return "inserted";
}

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

export async function isFilerRegistered(id: string): Promise<boolean> {
  const source = await readFile(FILERS_FILE, "utf8");
  return source.includes(`tribeId: "${id}"`);
}

export async function isTribeMemberRegistered(id: string): Promise<boolean> {
  const filer = await prisma.filer.findUnique({
    where: { tribeId: id },
    select: { personNameEn: true },
  });
  return filer?.personNameEn != null;
}
