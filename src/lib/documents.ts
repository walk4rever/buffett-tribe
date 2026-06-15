import prisma from "./prisma";

export type DocumentOwnerId = "buffett" | "duan" | "lilu";

export type DocumentItem = {
  id: string;
  ownerId: DocumentOwnerId;
  title: string;
  subtitle: string;
  badge: string;
  rawPath: string;
  readerHref: string;
  rawHref: string;
};

export async function getDocumentsForOwner(
  ownerId: DocumentOwnerId,
): Promise<DocumentItem[]> {
  const rows = await prisma.document.findMany({
    where: { ownerId },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    ownerId: r.ownerId as DocumentOwnerId,
    title: r.title,
    subtitle: r.subtitle ?? "",
    badge: r.badge ?? "",
    rawPath: r.rawPath,
    readerHref: r.readerPath,
    rawHref: r.apiPath,
  }));
}

export async function getDocumentById(id: string): Promise<DocumentItem | null> {
  const r = await prisma.document.findUnique({ where: { id } });
  if (!r) return null;
  return {
    id: r.id,
    ownerId: r.ownerId as DocumentOwnerId,
    title: r.title,
    subtitle: r.subtitle ?? "",
    badge: r.badge ?? "",
    rawPath: r.rawPath,
    readerHref: r.readerPath,
    rawHref: r.apiPath,
  };
}
