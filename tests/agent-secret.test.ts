import { afterEach, describe, expect, it } from "vitest";
import { isValidAgentSecret } from "@/lib/agent-secret";

const original = process.env.PI_AGENT_SECRET;

afterEach(() => {
  if (original === undefined) delete process.env.PI_AGENT_SECRET;
  else process.env.PI_AGENT_SECRET = original;
});

describe("agent secret validation", () => {
  it("accepts only the configured secret", () => {
    process.env.PI_AGENT_SECRET = "expected-secret";
    expect(isValidAgentSecret("expected-secret")).toBe(true);
    expect(isValidAgentSecret("wrong-secret")).toBe(false);
    expect(isValidAgentSecret(undefined)).toBe(false);
  });

  it("rejects all values when the secret is not configured", () => {
    delete process.env.PI_AGENT_SECRET;
    expect(isValidAgentSecret("expected-secret")).toBe(false);
    expect(isValidAgentSecret("")).toBe(false);
  });
});
