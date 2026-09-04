import { cache } from "react";
import prisma from "@/lib/prisma";

export interface TribeMember {
  id: string;
  category: "core" | "alpha";
  displayGroup: string;
  name: string;
  nameZh: string;
  firm: string;
  initials: string;
  materialLabel: string;
  materialSub: string;
  materialHref: string;
  holdingsHref: string;
}

// One color per tribe, not per member — a per-person palette doesn't scale
// (every new Alpha onboarding would need a fresh color pick). Core tribe
// members all share the brand red; Alpha Tribe members all share amber.
const CATEGORY_COLOR: Record<TribeMember["category"], string> = {
  core: "#8b0000",
  alpha: "#d97706",
};

export function getTribeMemberColor(member: Pick<TribeMember, "category">): string {
  return CATEGORY_COLOR[member.category];
}

const DISPLAY_GROUP: Record<TribeMember["category"], string> = {
  core: "部落成员",
  alpha: "Alpha 部落",
};

type FilerRow = {
  tribeId: string;
  name: string;
  isMasterPersona: boolean;
  personNameEn: string | null;
  personNameZh: string | null;
  initials: string | null;
  materialLabel: string;
  materialSub: string;
};

function toTribeMember(row: FilerRow): TribeMember {
  const category: TribeMember["category"] = row.isMasterPersona ? "core" : "alpha";
  return {
    id: row.tribeId,
    category,
    displayGroup: DISPLAY_GROUP[category],
    name: row.personNameEn ?? row.name,
    nameZh: row.personNameZh ?? row.personNameEn ?? row.name,
    firm: row.name,
    initials: row.initials ?? "??",
    materialLabel: row.materialLabel,
    materialSub: row.materialSub,
    materialHref: `/master/${row.tribeId}#library`,
    holdingsHref: `/master/${row.tribeId}#holdings`,
  };
}

// Request-scoped memoization (React `cache()`): several server components
// call getTribeMember(s) alongside other DB queries in the same request, so
// this avoids re-querying the Filer table for each one. Degrades gracefully
// to an unmemoized call when invoked outside a request context (e.g. from a
// CLI script), so it's safe to use from scripts/*.ts too.
export const getTribeMembers = cache(async (): Promise<TribeMember[]> => {
  const rows = await prisma.filer.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      tribeId: true,
      name: true,
      isMasterPersona: true,
      personNameEn: true,
      personNameZh: true,
      initials: true,
      materialLabel: true,
      materialSub: true,
    },
  });
  return rows.map(toTribeMember);
});

export async function getCoreTribeMembers(): Promise<TribeMember[]> {
  return (await getTribeMembers()).filter((m) => m.category === "core");
}

export async function getAlphaTribeMembers(): Promise<TribeMember[]> {
  return (await getTribeMembers()).filter((m) => m.category === "alpha");
}

export async function getTribeMember(id: string): Promise<TribeMember | null> {
  return (await getTribeMembers()).find((m) => m.id === id) ?? null;
}
