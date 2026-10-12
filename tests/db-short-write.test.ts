import { describe, expect, it, vi } from "vitest";

import { withShortWriteTransaction } from "../src/lib/db-short-write";

describe("withShortWriteTransaction", () => {
  it("sets local database timeouts before running the write", async () => {
    const events: string[] = [];
    const tx = {
      $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
        events.push(strings.join(""));
        return 0;
      }),
    };
    const transactionOptions: Array<{ maxWait: number; timeout: number }> = [];
    const transaction = vi.fn(async (
      callback: (client: typeof tx) => Promise<string>,
      options: { maxWait: number; timeout: number },
    ) => {
      transactionOptions.push(options);
      events.push("begin");
      const result = await callback(tx);
      events.push("commit");
      return result;
    });

    const result = await withShortWriteTransaction(
      { $transaction: transaction } as never,
      async () => {
        events.push("write");
        return "done";
      },
    );

    expect(result).toBe("done");
    expect(events).toEqual([
      "begin",
      "SET LOCAL lock_timeout = '5s'",
      "SET LOCAL statement_timeout = '30s'",
      "SET LOCAL idle_in_transaction_session_timeout = '10s'",
      "write",
      "commit",
    ]);
    expect(transactionOptions).toEqual([{
      maxWait: 5_000,
      timeout: 35_000,
    }]);
  });

  it("rolls back and propagates write failures", async () => {
    const tx = {
      $executeRaw: vi.fn(async () => 0),
    };
    const transaction = vi.fn(async (
      callback: (client: typeof tx) => Promise<void>,
    ) => callback(tx));
    const failure = new Error("lock timeout");

    await expect(
      withShortWriteTransaction(
        { $transaction: transaction } as never,
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
  });
});
