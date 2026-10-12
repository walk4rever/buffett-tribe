import { describe, expect, it } from "vitest";

import { runProcessGroup } from "../scripts/lib/run-process-group";

describe("runProcessGroup", () => {
  it("terminates its detached process group when the abort signal fires", async () => {
    const controller = new AbortController();
    const resultPromise = runProcessGroup(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { signal: controller.signal },
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();

    const result = await resultPromise;
    expect(result.signal).toBe("SIGTERM");
  }, 5_000);
});
