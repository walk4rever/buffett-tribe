/**
 * File-editing primitives for registering a new Alpha investor in the two
 * hand-maintained source-of-truth arrays:
 *   - FILERS in scripts/lib/13f-import-core.ts (drives 13F import)
 *   - TRIBE_MEMBERS in src/lib/tribe.ts (drives the tribe/master UI)
 *
 * Both inserts are idempotent: if an entry for the given id already exists,
 * the file is left untouched and the function reports it as already present.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FILERS_FILE = path.join(process.cwd(), "scripts", "lib", "13f-import-core.ts");
const TRIBE_FILE = path.join(process.cwd(), "src", "lib", "tribe.ts");
const FILERS_CLOSE = "] as const;";
const TRIBE_CLOSE = "];";

export type AlphaInvestorInput = {
  id: string;
  name: string;
  nameZh: string;
  firm: string;
  cik: string;
  aum?: string;
  color: string;
  icon: string;
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
  const source = await readFile(TRIBE_FILE, "utf8");
  if (source.includes(`id: "${input.id}"`)) return "already_present";

  const closeIndex = source.lastIndexOf(TRIBE_CLOSE);
  if (closeIndex === -1) throw new Error(`Could not find "${TRIBE_CLOSE}" in ${TRIBE_FILE}`);

  const aumLine = input.aum ? `    aum: "${escapeForDoubleQuotedString(input.aum)}",\n` : "";
  const block = `  {
    id: "${input.id}",
    category: "alpha",
    displayGroup: "Alpha 投资人",
    name: "${escapeForDoubleQuotedString(input.name)}",
    nameZh: "${escapeForDoubleQuotedString(input.nameZh)}",
    firm: "${escapeForDoubleQuotedString(input.firm)}",
    color: "${input.color}",
    initials: "${escapeForDoubleQuotedString(input.initials)}",
${aumLine}    materialLabel: "${escapeForDoubleQuotedString(input.materialLabel)}",
    materialSub: "${escapeForDoubleQuotedString(input.materialSub)}",
    materialHref: "/master/${input.id}#library",
    holdingsHref: "/master/${input.id}/holdings",
    hasData: true,
    icon: "${escapeForDoubleQuotedString(input.icon)}",
  },\n`;

  const updated = source.slice(0, closeIndex) + block + source.slice(closeIndex);
  await writeFile(TRIBE_FILE, updated, "utf8");
  return "inserted";
}

export async function isFilerRegistered(id: string): Promise<boolean> {
  const source = await readFile(FILERS_FILE, "utf8");
  return source.includes(`tribeId: "${id}"`);
}

export async function isTribeMemberRegistered(id: string): Promise<boolean> {
  const source = await readFile(TRIBE_FILE, "utf8");
  return source.includes(`id: "${id}"`);
}
