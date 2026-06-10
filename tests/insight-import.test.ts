import { describe, expect, it } from "vitest";
import {
  buildInsightImportData,
  parseInsightImportArgs,
} from "../scripts/lib/insight-import";

describe("insight import helpers", () => {
  it("parses file path and CLI overrides", () => {
    const args = parseInsightImportArgs([
      "--file",
      "/tmp/CI003 Test Article.md",
      "--source",
      "Invest Like the Best",
      "--tags",
      "商业模式, 技术, 商业模式",
      "--status",
      "draft",
      "--dry-run",
    ]);

    expect(args.filePath).toBe("/tmp/CI003 Test Article.md");
    expect(args.source).toBe("Invest Like the Best");
    expect(args.tags).toEqual(["商业模式", "技术", "商业模式"]);
    expect(args.status).toBe("draft");
    expect(args.dryRun).toBe(true);
  });

  it("uses frontmatter metadata and treats source URL as sourceUrl", () => {
    const args = parseInsightImportArgs(["/tmp/CI003 测试文章.md", "--source", "Invest Like the Best"]);
    const data = buildInsightImportData(
      `---
title: 测试文章
source: https://example.com/original
author: Test Author
date: 2026-06-09
tags: [公司治理, 资本分配]
description: 测试描述
---
正文内容`,
      args,
    );

    expect(data.title).toBe("测试文章");
    expect(data.slug).toBe("测试文章");
    expect(data.source).toBe("Invest Like the Best");
    expect(data.sourceUrl).toBe("https://example.com/original");
    expect(data.author).toBe("Test Author");
    expect(data.publishedAt?.toISOString()).toBe("2026-06-09T00:00:00.000Z");
    expect(data.tags).toEqual(["公司治理", "资本分配"]);
    expect(data.contentRaw).toBe("正文内容");
    expect(data.status).toBe("published");
  });

  it("normalizes legacy editorial callouts during import", () => {
    const args = parseInsightImportArgs(["/tmp/CI003 测试文章.md"]);
    const data = buildInsightImportData(
      `---
title: 测试文章
---
> [!NOTE]
> **背景说明**
> 本文译自某播客。

> [!TIP] 2026 跨时空复盘（案例）
> 复盘内容。

> [!NOTE] **巴菲特部落视角（估值）**
> 价值内容。`,
      args,
    );

    expect(data.contentRaw).toBe(`> [!Overview] 背景概览
> 本文译自某播客。

> [!Facts] 时空复盘
> 复盘内容。

> [!Value] 价值视角
> 价值内容。`);
  });

  it("lets CLI metadata override frontmatter", () => {
    const args = parseInsightImportArgs([
      "/tmp/CI003 原标题.md",
      "--title",
      "覆盖标题",
      "--slug",
      "custom-slug",
      "--date",
      "2026-01-02",
      "--tags",
      "A,B",
      "--external-id",
      "insight-003",
    ]);
    const data = buildInsightImportData(
      `---
title: 原标题
date: 2025-01-01
tags: [旧标签]
---
正文内容`,
      args,
    );

    expect(data.title).toBe("覆盖标题");
    expect(data.slug).toBe("custom-slug");
    expect(data.publishedAt?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(data.tags).toEqual(["A", "B"]);
    expect(data.externalId).toBe("insight-003");
  });

  it("infers title from filename when frontmatter has no title", () => {
    const args = parseInsightImportArgs(["/tmp/CI004 商业模式演进.md"]);
    const data = buildInsightImportData("正文内容", args);

    expect(data.title).toBe("商业模式演进");
    expect(data.slug).toBe("商业模式演进");
  });

  it("rejects invalid status and date", () => {
    expect(() => parseInsightImportArgs(["a.md", "--status", "live"])).toThrow("Invalid --status");

    const args = parseInsightImportArgs(["a.md", "--date", "not-a-date"]);
    expect(() => buildInsightImportData("正文内容", args)).toThrow("Invalid date");
  });
});
