import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it, vi } from "vitest";

// tools/index.ts imports the pg pool module, which requires DIRECT_URL at
// module load. No connection is opened; this only lets the registry load.
vi.hoisted(() => {
  process.env.DIRECT_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
});

import {
  ALLOWED_TOOL_NAMES,
  GATEWAY_SYSTEM_PROMPT,
  buildGatewayResourceLoader,
} from "./agent-config.js";
import { STATIC_GATEWAY_TOOLS } from "./tools/index.js";

const agentDir = mkdtempSync(join(tmpdir(), "value-tribe-agent-"));

afterAll(() => {
  rmSync(agentDir, { recursive: true, force: true });
});

describe("gateway agent configuration", () => {
  it("exposes exactly the allowlisted tools", () => {
    const registered = STATIC_GATEWAY_TOOLS.map((tool) => tool.name).sort();
    const expected = ALLOWED_TOOL_NAMES
      .filter((name) => name !== "search_holdings")
      .sort();

    expect(ALLOWED_TOOL_NAMES).toHaveLength(13);
    expect(registered).toEqual(expected);
    expect(ALLOWED_TOOL_NAMES).toContain("search_holdings");
    expect(ALLOWED_TOOL_NAMES).not.toContain("get_company_analysis");
    expect(registered).not.toContain("run_experiment");
    expect(registered).not.toContain("bash");
  });

  it("uses an investment-research system prompt with untrusted-web rules", () => {
    expect(GATEWAY_SYSTEM_PROMPT).toContain("Value Tribe");
    expect(GATEWAY_SYSTEM_PROMPT).toContain("untrusted data");
    expect(GATEWAY_SYSTEM_PROMPT).not.toContain("coding assistant");
  });

  it("loads only the gateway persona, ignoring ambient context and skills", async () => {
    mkdirSync(join(agentDir, "skills", "demo"), { recursive: true });
    writeFileSync(join(agentDir, "AGENTS.md"), "AMBIENT GLOBAL AGENT");
    writeFileSync(join(agentDir, "CLAUDE.md"), "AMBIENT GLOBAL CLAUDE");
    writeFileSync(
      join(agentDir, "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: should not load\n---\n",
    );

    const loader = await buildGatewayResourceLoader(agentDir);
    const files = (loader as unknown as {
      agentsFiles: Array<{ path: string; content: string }>;
    }).agentsFiles;

    expect(files.map((file) => file.path)).toEqual(["/virtual/AGENTS.md"]);
    expect(files[0].content).toContain("Value Tribe");
    expect(files.some((file) => file.path.includes("CLAUDE.md"))).toBe(false);
    expect((loader as unknown as { skills: unknown[] }).skills).toEqual([]);
    expect(
      (loader as unknown as {
        extensionsResult?: { extensions: unknown[] };
      }).extensionsResult?.extensions ?? [],
    ).toEqual([]);
  });
});
