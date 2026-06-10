import { describe, expect, it } from "vitest";
import {
  normalizeInsightSlug,
  parseInsightFrontmatter,
  markdownToHtmlMarkdown,
  estimateReadingMinutes,
  rehypeInsightCallouts,
  normalizeInsightLegacyCallouts,
} from "../src/lib/insights";

describe("insights helper library", () => {
  it("normalizeInsightSlug normalizes slugs correctly", () => {
    expect(normalizeInsightSlug("Hello World! 123")).toBe("hello-world-123");
    expect(normalizeInsightSlug("价值投资 & 资本分配")).toBe("价值投资-资本分配");
    expect(normalizeInsightSlug("  --A--B--  ")).toBe("a-b");
  });

  it("parseInsightFrontmatter parses metadata and content correctly", () => {
    const raw = `---
title: "测试标题"
description: "这是一个测试"
tags: [价值投资, 公司治理]
date: "2026-06-09"
---
这是正文内容。`;
    const parsed = parseInsightFrontmatter(raw);
    expect(parsed.metadata.title).toBe("测试标题");
    expect(parsed.metadata.description).toBe("这是一个测试");
    expect(parsed.metadata.tags).toEqual(["价值投资", "公司治理"]);
    expect(parsed.metadata.date).toBe("2026-06-09");
    expect(parsed.content.trim()).toBe("这是正文内容。");
  });

  it("markdownToHtmlMarkdown normalizes callouts without line merging", () => {
    const raw = `> [!note]\n> This is content.`;
    expect(markdownToHtmlMarkdown(raw)).toBe(`> [!NOTE] \n> This is content.`);
  });

  it("markdownToHtmlMarkdown does not consume empty lines/newlines before callouts", () => {
    const raw = `> First paragraph.\n\n> [!NOTE] Second block\n> content.`;
    const result = markdownToHtmlMarkdown(raw);
    expect(result).toBe(`> First paragraph.\n\n> [!NOTE] Second block\n> content.`);
  });

  it("normalizeInsightLegacyCallouts remaps legacy editorial callouts to overview facts value", () => {
    const raw = `> [!NOTE]
> **背景说明**
> 本文译自 Business Breakdowns。

> [!TIP] 2026 跨时空复盘（生态整合）
> 复盘内容。

> [!IMPORTANT] 2026 跨时空评注（资本开支）
> 另一段复盘。

> [!NOTE] **巴菲特部落视角（护城河）**
> 价值判断。`;

    expect(normalizeInsightLegacyCallouts(raw)).toBe(`> [!Overview] 背景概览
> 本文译自 Business Breakdowns。

> [!Facts] 时空复盘
> 复盘内容。

> [!Facts] 时空复盘
> 另一段复盘。

> [!Value] 价值视角
> 价值判断。`);
  });

  it("normalizeInsightLegacyCallouts remaps buffett-and-munger legacy notes to value", () => {
    const raw = `> [!NOTE]
> **巴菲特与芒格的多学科思维模型**
> 内容。`;

    expect(normalizeInsightLegacyCallouts(raw)).toBe(`> [!Value] 价值视角
> 内容。`);
  });

  it("normalizeInsightLegacyCallouts keeps already standardized callouts unchanged", () => {
    const raw = `> [!Overview] 背景概览
> 内容

> [!Facts] 时空复盘
> 内容`;

    expect(normalizeInsightLegacyCallouts(raw)).toBe(raw);
  });

  it("estimateReadingMinutes estimates reading time correctly", () => {
    // 450 Chinese characters = 1 minute
    const cnContent = "测试".repeat(225); // 450 chars
    expect(estimateReadingMinutes(cnContent)).toBe(1);

    // 220 English words = 1 minute
    const enContent = "word ".repeat(220);
    expect(estimateReadingMinutes(enContent)).toBe(1);
  });

  it("rehypeInsightCallouts transforms blockquote to aside", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "blockquote",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [
                {
                  type: "text",
                  value: "[!NOTE]\nThis is the content.",
                },
              ],
            },
          ],
        },
      ],
    };

    const transform = rehypeInsightCallouts();
    transform(mockTree);

    const aside = mockTree.children[0];
    expect(aside.type).toBe("element");
    expect(aside.tagName).toBe("aside");
    expect(aside.properties.className).toContain("insight-callout");
    expect(aside.properties.className).toContain("insight-callout--note");

    const titleDiv = aside.children[0];
    expect(titleDiv.tagName).toBe("div");
    expect(titleDiv.properties.className).toContain("insight-callout-header");
    expect(titleDiv.children[1].properties.className).toContain("insight-callout-title");
    expect(titleDiv.children[1].children[0].value).toBe("NOTE");

    const contentP = aside.children[1];
    expect(contentP.tagName).toBe("p");
    expect(contentP.children[0].value).toBe("This is the content.");
  });

  it("rehypeInsightCallouts transforms custom title callouts correctly", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "blockquote",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [
                {
                  type: "text",
                  value: "[!TIP] Custom Title\nThis is content.",
                },
              ],
            },
          ],
        },
      ],
    };

    const transform = rehypeInsightCallouts();
    transform(mockTree);

    const aside = mockTree.children[0];
    expect(aside.tagName).toBe("aside");
    expect(aside.properties.className).toContain("insight-callout--tips");

    const titleDiv = aside.children[0];
    expect(titleDiv.children[1].children[0].value).toBe("Custom Title");

    const contentP = aside.children[1];
    expect(contentP.children[0].value).toBe("This is content.");
  });

  it("rehypeInsightCallouts preserves note and facts base classes", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "blockquote",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [
                {
                  type: "text",
                  value: "[!IMPORTANT] 2026 跨时空复盘（三大个股案例的十年结局)\nContent.",
                },
              ],
            },
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [
                {
                  type: "text",
                  value: "[!NOTE] 巴菲特部落视角（伟大企业与便宜企业的永恒抉择）\nContent.",
                },
              ],
            },
          ],
        },
      ],
    };

    const transform = rehypeInsightCallouts();
    transform(mockTree);

    expect(mockTree.children[0].properties.className).toContain("insight-callout--facts");
    expect(mockTree.children[1].properties.className).toContain("insight-callout--note");
  });

  it("rehypeInsightCallouts keeps explicit note titles after a note marker", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "blockquote",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [
                { type: "text", value: "[!NOTE] " },
                {
                  type: "element",
                  tagName: "strong",
                  properties: {},
                  children: [{ type: "text", value: "巴菲特部落视角（伯克希尔的选人标准）" }],
                },
              ],
            },
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [{ type: "text", value: "沃伦·巴菲特常说，经理人必须具备诚信。" }],
            },
          ],
        },
      ],
    };

    const transform = rehypeInsightCallouts();
    transform(mockTree);

    const aside = mockTree.children[0];
    expect(aside.properties.className).toContain("insight-callout--note");
    expect(aside.children[0].children[1].children[0].value).toBe("NOTE");
    expect(aside.children[1].children[1].tagName).toBe("strong");
    expect(aside.children[2].children[0].value).toBe("沃伦·巴菲特常说，经理人必须具备诚信。");
  });

  it("rehypeInsightCallouts keeps explicit note titles on the first paragraph", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "blockquote",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [
                { type: "text", value: "[!NOTE] " },
                {
                  type: "element",
                  tagName: "strong",
                  properties: {},
                  children: [{ type: "text", value: "背景说明" }],
                },
              ],
            },
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [{ type: "text", value: "本文译自 Business Breakdowns。" }],
            },
          ],
        },
      ],
    };

    const transform = rehypeInsightCallouts();
    transform(mockTree);

    const aside = mockTree.children[0];
    expect(aside.properties.className).toContain("insight-callout--note");
    expect(aside.children[0].children[1].children[0].value).toBe("NOTE");
    expect(aside.children[1].children[1].tagName).toBe("strong");
  });

  it("rehypeInsightCallouts keeps a note title without a subtitle", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "blockquote",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [
                { type: "text", value: "[!NOTE] " },
                {
                  type: "element",
                  tagName: "strong",
                  properties: {},
                  children: [{ type: "text", value: "巴菲特部落视角" }],
                },
              ],
            },
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [{ type: "text", value: "从巴菲特的投资哲学来剖析 S 曲线。" }],
            },
          ],
        },
      ],
    };

    const transform = rehypeInsightCallouts();
    transform(mockTree);

    const aside = mockTree.children[0];
    expect(aside.properties.className).toContain("insight-callout--note");
    expect(aside.children[0].children[1].children[0].value).toBe("NOTE");
    expect(aside.children[1].children[1].tagName).toBe("strong");
  });

  it("rehypeInsightCallouts preserves note paragraph body when title is inline", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "blockquote",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [
                { type: "text", value: "[!NOTE] " },
                {
                  type: "element",
                  tagName: "strong",
                  properties: {},
                  children: [{ type: "text", value: "巴菲特部落视角（坪效的魔力）" }],
                },
                { type: "text", value: "\n数字化带来的经济商誉会提高单店回报。" },
              ],
            },
          ],
        },
      ],
    };

    const transform = rehypeInsightCallouts();
    transform(mockTree);

    const aside = mockTree.children[0];
    expect(aside.children[0].children[1].children[0].value).toBe("NOTE");
    expect(aside.children[1].children[1].children[0].value).toBe("巴菲特部落视角（坪效的魔力）");
  });

  it("rehypeInsightCallouts drops empty blockquote fragments around callouts", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "blockquote",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [{ type: "text", value: "\n" }],
            },
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [{ type: "text", value: "[!TIP] 2026 跨时空复盘\nContent." }],
            },
          ],
        },
      ],
    };

    const transform = rehypeInsightCallouts();
    transform(mockTree);

    expect(mockTree.children).toHaveLength(1);
    expect(mockTree.children[0].tagName).toBe("aside");
    expect(mockTree.children[0].properties.className).toContain("insight-callout--tips");
  });

  it("rehypeInsightCallouts splits consecutive callouts within a single blockquote", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "blockquote",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [
                {
                  type: "text",
                  value: "[!TIP] First Callout\nTip content.",
                },
              ],
            },
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [
                {
                  type: "text",
                  value: "[!NOTE] Second Callout\nNote content.",
                },
              ],
            },
          ],
        },
      ],
    };

    const transform = rehypeInsightCallouts();
    transform(mockTree);

    expect(mockTree.children.length).toBe(2);

    const firstAside = mockTree.children[0];
    expect(firstAside.tagName).toBe("aside");
    expect(firstAside.properties.className).toContain("insight-callout--tips");
    expect(firstAside.children[0].children[1].children[0].value).toBe("First Callout");
    expect(firstAside.children[1].children[0].value).toBe("Tip content.");

    const secondAside = mockTree.children[1];
    expect(secondAside.tagName).toBe("aside");
    expect(secondAside.properties.className).toContain("insight-callout--note");
    expect(secondAside.children[0].children[1].children[0].value).toBe("Second Callout");
    expect(secondAside.children[1].children[0].value).toBe("Note content.");
  });
});
