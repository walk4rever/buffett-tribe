import { describe, expect, it } from "vitest";
import { proxySecImageUrls } from "../src/lib/filing-html";

describe("proxySecImageUrls", () => {
  it("routes an img src pointing at sec.gov through the proxy", () => {
    const html = `<img src="https://www.sec.gov/Archives/edgar/data/1717115/000119312526066961/img119055556_0.jpg" alt="x"/>`;
    const result = proxySecImageUrls(html);
    expect(result).toBe(
      `<img src="/api/filing-image?url=${encodeURIComponent(
        "https://www.sec.gov/Archives/edgar/data/1717115/000119312526066961/img119055556_0.jpg",
      )}" alt="x"/>`,
    );
  });

  it("leaves non-img sec.gov links (e.g. href navigation) untouched", () => {
    const html = `<a href="https://www.sec.gov/Archives/edgar/data/1717115/000119312526066961/tem-20251231.htm">10-K</a>`;
    expect(proxySecImageUrls(html)).toBe(html);
  });

  it("leaves non-sec.gov and data-uri image srcs untouched", () => {
    const html = `<img src="data:image/png;base64,AAAA"/><img src="https://example.com/logo.png"/>`;
    expect(proxySecImageUrls(html)).toBe(html);
  });

  it("handles multiple images and preserves other attributes", () => {
    const html =
      `<img alt="a" src="https://www.sec.gov/Archives/1.jpg" style="width:1px"/>` +
      `<img alt="b" src="https://www.sec.gov/Archives/2.gif"/>`;
    const result = proxySecImageUrls(html);
    expect(result).toContain(`src="/api/filing-image?url=${encodeURIComponent("https://www.sec.gov/Archives/1.jpg")}"`);
    expect(result).toContain(`src="/api/filing-image?url=${encodeURIComponent("https://www.sec.gov/Archives/2.gif")}"`);
    expect(result).toContain('alt="a"');
    expect(result).toContain('style="width:1px"');
  });
});
