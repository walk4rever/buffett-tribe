const MAX_COMPANY_LINKS = 100;
const MAX_ENTITY_ID_LENGTH = 128;

export function parseCompanyEntityIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_COMPANY_LINKS) return null;

  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const id = item.trim();
    if (!id || id.length > MAX_ENTITY_ID_LENGTH) return null;
    if (!ids.includes(id)) ids.push(id);
  }

  return ids;
}

export function mergeCompanyEntityIds(
  existingEntityIds: string[],
  existingCompanyIds: string[],
  selectedCompanyIds: string[],
): string[] {
  const oldCompanyIds = new Set(existingCompanyIds);
  const preservedEntityIds = existingEntityIds.filter((id) => !oldCompanyIds.has(id));
  return [...new Set([...preservedEntityIds, ...selectedCompanyIds])];
}
