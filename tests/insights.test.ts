import { describe, expect, it } from "vitest";
import {
  normalizeInsightSlug,
  parseInsightFrontmatter,
  markdownToHtmlMarkdown,
  estimateReadingMinutes,
  rehypeInsightCallouts,
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
    expect(titleDiv.properties.className).toContain("insight-callout-title");
    expect(titleDiv.children[0].value).toBe("NOTE");

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
    expect(aside.properties.className).toContain("insight-callout--tip");

    const titleDiv = aside.children[0];
    expect(titleDiv.children[0].value).toBe("Custom Title");

    const contentP = aside.children[1];
    expect(contentP.children[0].value).toBe("This is content.");
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
    expect(firstAside.properties.className).toContain("insight-callout--tip");
    expect(firstAside.children[0].children[0].value).toBe("First Callout");
    expect(firstAside.children[1].children[0].value).toBe("Tip content.");

    const secondAside = mockTree.children[1];
    expect(secondAside.tagName).toBe("aside");
    expect(secondAside.properties.className).toContain("insight-callout--note");
    expect(secondAside.children[0].children[0].value).toBe("Second Callout");
    expect(secondAside.children[1].children[0].value).toBe("Note content.");
  });
});
