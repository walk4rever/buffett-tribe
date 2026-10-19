import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison for the shared secret used by the agent gateway. */
export function isValidAgentSecret(value: string | null | undefined): boolean {
  const expected = process.env.PI_AGENT_SECRET;
  if (!expected || !value) return false;

  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
