import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uploadInsightLocalImages } from "../scripts/lib/insight-media";

describe("uploadInsightLocalImages", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "insight-media-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("leaves content unchanged when there are no local image references", async () => {
    const content = "正文，没有图片。参考 ![已托管](https://example.com/a.png) 也不用动。";
    const result = await uploadInsightLocalImages(content, dir, "slug-a", { dryRun: true });
    expect(result.content).toBe(content);
    expect(result.uploads).toEqual([]);
  });

  it("dry-run rewrites markdown image syntax to a placeholder without touching the network", async () => {
    fs.writeFileSync(path.join(dir, "cover.png"), Buffer.from("fake-png-bytes"));
    const content = "开头。\n\n![封面](./cover.png)\n\n结尾。";

    const result = await uploadInsightLocalImages(content, dir, "slug-b", { dryRun: true });

    expect(result.uploads).toHaveLength(1);
    expect(result.uploads[0].localRef).toBe("./cover.png");
    expect(result.uploads[0].publicUrl).toContain("insights/slug-b/");
    expect(result.content).toContain(`![封面](${result.uploads[0].publicUrl})`);
    expect(result.content).not.toContain("./cover.png");
  });

  it("rewrites a raw <img> tag's src in place, keeping other attributes", async () => {
    fs.writeFileSync(path.join(dir, "chart.png"), Buffer.from("fake-chart-bytes"));
    const content = '<img src="./chart.png" alt="营收图" width="600">';

    const result = await uploadInsightLocalImages(content, dir, "slug-c", { dryRun: true });

    expect(result.content).toContain('alt="营收图" width="600"');
    expect(result.content).not.toContain("./chart.png");
  });

  it("skips a reference whose local file doesn't exist and leaves the markdown untouched", async () => {
    const content = "![missing](./does-not-exist.png)";
    const result = await uploadInsightLocalImages(content, dir, "slug-d", { dryRun: true });
    expect(result.uploads).toEqual([]);
    expect(result.content).toBe(content);
  });

  it("keys uploads by content hash so identical bytes at different re-imports resolve to the same key", async () => {
    fs.writeFileSync(path.join(dir, "a.png"), Buffer.from("same-bytes"));
    const content = "![a](./a.png)";

    const first = await uploadInsightLocalImages(content, dir, "slug-e", { dryRun: true });
    const second = await uploadInsightLocalImages(content, dir, "slug-e", { dryRun: true });

    expect(first.uploads[0].publicUrl).toBe(second.uploads[0].publicUrl);
    expect(first.uploads[0].publicUrl).toMatch(/^<would-upload:insights\/slug-e\/[a-f0-9]{8}-a\.png>$/);
  });

  it("gives different files different content-hash keys even with the same filename", async () => {
    fs.mkdirSync(path.join(dir, "v1"));
    fs.mkdirSync(path.join(dir, "v2"));
    fs.writeFileSync(path.join(dir, "v1", "a.png"), Buffer.from("version-one"));
    fs.writeFileSync(path.join(dir, "v2", "a.png"), Buffer.from("version-two"));

    const first = await uploadInsightLocalImages("![a](./v1/a.png)", dir, "slug-f", { dryRun: true });
    const second = await uploadInsightLocalImages("![a](./v2/a.png)", dir, "slug-f", { dryRun: true });

    expect(first.uploads[0].publicUrl).not.toBe(second.uploads[0].publicUrl);
  });
});
