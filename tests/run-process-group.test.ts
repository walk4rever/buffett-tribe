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

  it("captures stdout and exit code cleanly", async () => {
    const result = await runProcessGroup(process.execPath, [
      "-e",
      "console.log('hello from process group');",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.output.trim()).toBe("hello from process group");
  });

  it("streams to process.stdout when inheritStdio is enabled while still capturing output", async () => {
    let intercepted = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      intercepted += String(chunk);
      return true;
    }) as unknown as typeof process.stdout.write;

    try {
      const result = await runProcessGroup(
        process.execPath,
        ["-e", "console.log('streaming message');"],
        { inheritStdio: true },
      );

      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe("streaming message");
      expect(intercepted).toContain("streaming message");
    } finally {
      process.stdout.write = origWrite;
    }
  });
});
