import type { Prisma, PrismaClient } from "@prisma/client";

const TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 35_000,
};

type TransactionRunner = Pick<PrismaClient, "$transaction">;

export async function withShortWriteTransaction<T>(
  db: TransactionRunner,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
    await tx.$executeRaw`SET LOCAL idle_in_transaction_session_timeout = '10s'`;
    return write(tx);
  }, TRANSACTION_OPTIONS);
}
