import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWebPageTool } from "./fetch-web-page.js";

const originalKey = process.env.DEEPSEEK_API_KEY;

type ToolOutput = { content: Array<{ text: string }>; details: unknown };
const execute = (fetchWebPageTool as unknown as {
  execute(
    id: string,
    params: { url: string },
    signal?: AbortSignal,
  ): Promise<ToolOutput>;
}).execute;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function run(url: string) {
  return execute("call", { url });
}

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_RETRY_DELAY_MS = "0";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
  delete process.env.DEEPSEEK_RETRY_DELAY_MS;
});

describe("fetch_web_page", () => {
  it("rejects non-HTTP URLs without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const output = await run("ftp://example.com/file");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(output.content[0].text).toContain("Only HTTP and HTTPS");
  });

  it("rejects URLs containing credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const output = await run("https://user:pass@example.com/page");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(output.content[0].text).toContain("must not contain credentials");
  });

  it("rejects localhost and private-network literals", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const url of [
      "http://localhost:3456/health",
      "http://127.0.0.1/admin",
      "http://192.168.1.20/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
    ]) {
      const output = await run(url);
      expect(output.content[0].text).toContain("Private, local");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the page title and markdown content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({ title: "Example article", content: "# Body\n\nText" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const output = await run("https://example.com/article");

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/v1/tools/fetch");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      url: "https://example.com/article",
    });
    expect(output.content[0].text).toContain("# Example article");
    expect(output.content[0].text).toContain("Text");
    expect(output.details).toMatchObject({ truncated: false });
  });

  it("truncates very long pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ title: "Long", content: "x".repeat(25000) })),
    );

    const output = await run("https://example.com/long");

    expect(output.content[0].text).toContain("[Page content truncated");
    expect(output.details).toMatchObject({ truncated: true, chars: 25000 });
  });

  it("surfaces a blocked-page error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ error: { message: "blocked" } }, 403)),
    );

    const output = await run("https://example.com/blocked");

    expect(output.content[0].text).toContain("blocked by DeepSeek's security policy");
  });
});
