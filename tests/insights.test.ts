import { describe, expect, it } from "vitest";
import {
  extractInsightOverviewShareContent,
  buildInsightHighlightShareText,
  normalizeInsightSlug,
  parseInsightFrontmatter,
  markdownToHtmlMarkdown,
  estimateReadingMinutes,
  rehypeInsightCallouts,
  rehypeInsightEmbeds,
  normalizeInsightLegacyCallouts,
} from "../src/lib/insights";

function paragraphWithLink(href: string, text = href) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockTree: any = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "a",
            properties: { href },
            children: [{ type: "text", value: text }],
          },
        ],
      },
    ],
  };
  rehypeInsightEmbeds()(mockTree);
  return mockTree.children[0];
}

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

  it("extractInsightOverviewShareContent extracts normalized overview markdown", () => {
    const raw = `> [!Overview] 背景概览
> 第一段。
>
> - 要点一
> - 要点二

## 正文

内容`;

    expect(extractInsightOverviewShareContent(raw, "后备摘要")).toEqual({
      title: "背景概览",
      markdown: "第一段。\n\n- 要点一\n- 要点二",
    });
  });

  it("extractInsightOverviewShareContent falls back to description when no overview exists", () => {
    expect(extractInsightOverviewShareContent("正文第一段。\n\n正文第二段。", "后备摘要")).toEqual({
      title: "背景概览",
      markdown: "后备摘要",
    });
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

  it("rehypeInsightCallouts recognizes the Highlights type with its localized default title", () => {
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
              children: [{ type: "text", value: "[!HIGHLIGHTS]\nTL;DR content." }],
            },
          ],
        },
      ],
    };

    const transform = rehypeInsightCallouts();
    transform(mockTree);

    const aside = mockTree.children[0];
    expect(aside.tagName).toBe("aside");
    expect(aside.properties.className).toContain("insight-callout--highlights");
    expect(aside.properties["data-base-callout"]).toBe("highlights");
    expect(aside.properties.style).toContain("--insight-callout-accent-color: #dc2626");
    expect(aside.properties.style).toContain("linear-gradient");

    const titleDiv = aside.children[0];
    expect(titleDiv.children[0].children[0].value).toBe("Highlights");
    expect(titleDiv.children[1].children[0].value).toBe("高光金句");

    const contentP = aside.children[1];
    expect(contentP.children[0].value).toBe("TL;DR content.");
  });

  it("rehypeInsightEmbeds converts a bare YouTube link paragraph into a sandboxed video iframe", () => {
    const embed = paragraphWithLink("https://youtu.be/dQw4w9WgXcQ");

    expect(embed.tagName).toBe("div");
    expect(embed.properties.className).toEqual(["insight-embed", "insight-embed--video"]);
    expect(embed.properties.style).toBe("aspect-ratio: 16 / 9");

    const iframe = embed.children[0];
    expect(iframe.tagName).toBe("iframe");
    expect(iframe.properties.src).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(iframe.properties.allowFullScreen).toBe(true);
  });

  it("rehypeInsightEmbeds recognizes a full youtube.com/watch URL with extra query params", () => {
    const embed = paragraphWithLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s");
    expect(embed.children[0].properties.src).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("rehypeInsightEmbeds converts a Spotify episode link into an audio iframe with a fixed height", () => {
    const embed = paragraphWithLink("https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk");

    expect(embed.properties.className).toEqual(["insight-embed", "insight-embed--audio"]);
    expect(embed.properties.style).toBe("height: 232px");
    expect(embed.children[0].properties.src).toBe("https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk");
    expect(embed.children[0].properties.allowFullScreen).toBe(false);
  });

  it("rehypeInsightEmbeds converts an Apple Podcasts link by prefixing the embed subdomain", () => {
    const embed = paragraphWithLink("https://podcasts.apple.com/us/podcast/some-show/id123?i=456");
    expect(embed.children[0].properties.src).toBe("https://embed.podcasts.apple.com/us/podcast/some-show/id123?i=456");
  });

  it("rehypeInsightEmbeds embeds even when the author gives the link custom text", () => {
    const embed = paragraphWithLink("https://youtu.be/dQw4w9WgXcQ", "点这里看原视频");
    expect(embed.tagName).toBe("div");
  });

  it("rehypeInsightEmbeds leaves an unrecognized link paragraph as a normal paragraph", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            { type: "element", tagName: "a", properties: { href: "https://example.com/article" }, children: [{ type: "text", value: "https://example.com/article" }] },
          ],
        },
      ],
    };
    rehypeInsightEmbeds()(mockTree);
    expect(mockTree.children[0].tagName).toBe("p");
  });

  it("rehypeInsightEmbeds leaves a paragraph with a link plus surrounding text untouched", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            { type: "text", value: "参考视频：" },
            { type: "element", tagName: "a", properties: { href: "https://youtu.be/dQw4w9WgXcQ" }, children: [{ type: "text", value: "https://youtu.be/dQw4w9WgXcQ" }] },
          ],
        },
      ],
    };
    rehypeInsightEmbeds()(mockTree);
    expect(mockTree.children[0].tagName).toBe("p");
    expect(mockTree.children[0].children).toHaveLength(2);
  });

  describe("buildInsightHighlightShareText", () => {
    it("builds correct highlight copy text with Value Tribe promotion, quote, and article link", () => {
      const text = buildInsightHighlightShareText({
        title: "巴菲特致股东信精选",
        slug: "berkshire-shareholder-letter",
        quoteText: "对于一家拥有持久竞争优势的公司，时间是它的朋友；而对于平庸的公司，时间则是它的敌人。",
      });

      expect(text).toContain("【Value Tribe · 价值部落】");
      expect(text).toContain("买股票就是买公司。用投资大师的框架深度理解一家公司。");
      expect(text).toContain("“对于一家拥有持久竞争优势的公司，时间是它的朋友；而对于平庸的公司，时间则是它的敌人。”");
      expect(text).toContain("—— 摘自《巴菲特致股东信精选》");
      expect(text).toContain("🔗 原文链接：https://vt.air7.fun/insights/berkshire-shareholder-letter");
    });

    it("includes distinct source attribution when source is present and not the brand name", () => {
      const text = buildInsightHighlightShareText({
        title: "微软的云与AI护城河",
        slug: "microsoft-cloud-ai",
        quoteText: "商业模式的核心在于高转换成本与持续的网络效应。",
        source: "Acquired",
      });

      expect(text).toContain("—— 摘自《微软的云与AI护城河》 · Acquired");
    });

    it("does not duplicate brand name if source matches brand", () => {
      const text = buildInsightHighlightShareText({
        title: "商业模式与资本配置",
        slug: "business-capital-allocation",
        quoteText: "自由现金流是一切估值的锚点。",
        source: "Value Tribe",
      });

      expect(text).toContain("—— 摘自《商业模式与资本配置》");
      expect(text).not.toContain("· Value Tribe");
    });

    it("does not double-wrap title with brackets if title already has them", () => {
      const text = buildInsightHighlightShareText({
        title: "《穷查理宝典精要》",
        slug: "poor-charlie-almanack",
        quoteText: "反过来想，总是反过来想。",
      });

      expect(text).toContain("—— 摘自《穷查理宝典精要》");
      expect(text).not.toContain("《《");
    });

    it("supports custom siteOrigin if specified", () => {
      const text = buildInsightHighlightShareText({
        title: "测试文章",
        slug: "test-slug",
        quoteText: "测试段落",
        siteOrigin: "https://custom.domain.com",
      });

      expect(text).toContain("🔗 原文链接：https://custom.domain.com/insights/test-slug");
    });
  });
});
