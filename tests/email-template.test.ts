import { describe, it, expect } from "vitest";
import {
  buildFullEmailHtml,
  renderMarkdownToEmailHtml,
  substituteTokens,
} from "@/lib/email-template";

describe("Email Template & Markdown Transformer", () => {
  it("substitutes {{name}} with provided user name or fallback", () => {
    expect(substituteTokens("你好 {{name}}", { name: "巴菲特" })).toBe("你好 巴菲特");
    expect(substituteTokens("你好 {{name}}", {})).toBe("你好 投资朋友");
    expect(substituteTokens("用户：{{name}}，邮箱：{{email}}", { name: "李录", email: "lilu@himalaya.com" })).toBe(
      "用户：李录，邮箱：lilu@himalaya.com"
    );
  });

  it("renders markdown headings, lists, quotes with inline styles", () => {
    const md = `## 核心特性
- 功能 1
- 功能 2

> 这是一张特性卡片`;

    const html = renderMarkdownToEmailHtml(md);
    expect(html).toContain("<h2 style=");
    expect(html).toContain("核心特性");
    expect(html).toContain("<ul style=");
    expect(html).toContain("功能 1");
    expect(html).toContain("这是一张特性卡片");
  });

  it("renders CTA button when #button hash is used in link", () => {
    const md = "[立即体验 →](/agent#button)";
    const html = renderMarkdownToEmailHtml(md, undefined, "https://vt.air7.fun");

    expect(html).toContain("https://vt.air7.fun/agent");
    expect(html).toContain("立即体验 →");
    expect(html).toContain("border-radius:8px");
    expect(html).toContain("background:#0071e3");
  });

  it("renders WeChat CTA button with green styling when #wechat hash is used in link", () => {
    const md = "[加我微信交流](/wechat-qr.jpeg#wechat)";
    const html = renderMarkdownToEmailHtml(md, undefined, "https://vt.air7.fun");

    expect(html).toContain("加我微信交流");
    expect(html).toContain("background:#07c160");
  });

  it("renders WeChat QR code image nicely sized and centered", () => {
    const md = "![微信二维码](https://pub-675abd2580e643e89dde5e766edae1b7.r2.dev/buffett-tribe/email/announcement-2026-06/wechat-qr.jpeg#wechat)";
    const html = renderMarkdownToEmailHtml(md, undefined, "https://vt.air7.fun");

    expect(html).toContain("wechat-qr.jpeg");
    expect(html).toContain('width="190"');
    expect(html).toContain("text-align:center");
  });

  it("builds full responsive email html document with header, markdown body, and footer", () => {
    const html = buildFullEmailHtml({
      subject: "产品发布通知",
      markdown: "欢迎体验全新功能！",
      preheader: "本期重大更新发布",
      user: { name: "段永平", email: "duan@example.com" },
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("本期重大更新发布");
    expect(html).toContain("Value Tribe");
    expect(html).toContain("logo-white.svg");
    expect(html).toContain("买股票就是买公司，知识库+Agent让你更好地理解一家公司！");
    expect(html).toContain("欢迎体验全新功能！");
    expect(html).toContain("退订");
  });
});
