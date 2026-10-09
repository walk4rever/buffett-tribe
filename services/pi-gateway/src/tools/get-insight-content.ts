import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { pool } from "../db.js";
import { BRAND_EN } from "../brand.js";

type InsightRow = {
  title: string;
  format: string;
  content_raw: string;
  published_at: string | null;
};

function htmlToReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type InsightSearchRow = {
  slug: string;
  title: string;
  description: string | null;
  format: string;
  content_raw: string;
  published_at: string | null;
};

export const getInsightContentTool = defineTool({
  name: "get_insight_content",
  label: `Search and Get ${BRAND_EN} Insight Articles`,
  description:
    `Search or fetch published ${BRAND_EN} insight articles (/insights). Provide 'query' to search by topic/company/keyword (e.g. 比亚迪, 巴菲特股东信, 消费), or 'slug' to get an exact article's full text.`,
  promptSnippet: "get_insight_content(query?, slug?) → published insight article or search results",
  parameters: Type.Object({
    query: Type.Optional(Type.String({
      description: "Topic, company, or keyword to search across insight articles (e.g. 比亚迪, 巴菲特, 科技, 医疗)",
    })),
    slug: Type.Optional(Type.String({
      description: "Exact insight article slug if known, e.g. buffett-2025-letter-notes",
    })),
  }),
  async execute(_id, params, signal) {
    const { slug, query } = params;

    if (!slug && !query) {
      return {
        content: [{ type: "text" as const, text: "请提供 query（搜索关键词）或 slug（文章代码）以查询深度洞见。" }],
        details: null,
      };
    }

    if (signal?.aborted) {
      return { content: [{ type: "text" as const, text: "Cancelled." }], details: null };
    }

    // 1. Direct Slug Lookup
    if (slug) {
      let row: InsightRow | undefined;
      try {
        const result = await pool.query<InsightRow>(
          `SELECT title, format, "contentRaw" AS content_raw, to_char("publishedAt", 'YYYY-MM-DD') AS published_at
           FROM "InsightPost"
           WHERE slug = $1 AND status = 'published'
           LIMIT 1`,
          [slug.trim()],
        );
        row = result.rows[0];
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Failed to fetch insight article: ${msg}` }], details: null };
      }

      if (row) {
        const body = row.format === "html" ? htmlToReadableText(row.content_raw) : row.content_raw;
        const text = [
          `**${row.title}**`,
          row.published_at ? `Published: ${row.published_at}` : "",
          "",
          body,
        ].filter(Boolean).join("\n");
        return { content: [{ type: "text" as const, text }], details: { slug } };
      }
    }

    // 2. Keyword Search
    const searchTerm = (query ?? slug ?? "").trim();
    try {
      const searchResult = await pool.query<InsightSearchRow>(
        `SELECT slug, title, description, format, "contentRaw" AS content_raw, to_char("publishedAt", 'YYYY-MM-DD') AS published_at
         FROM "InsightPost"
         WHERE status = 'published'
           AND (
             title ILIKE $1
             OR slug ILIKE $1
             OR description ILIKE $1
             OR array_to_string(tags, ' ') ILIKE $1
             OR "contentRaw" ILIKE $1
           )
         ORDER BY "publishedAt" DESC
         LIMIT 5`,
        [`%${searchTerm}%`],
      );

      const rows = searchResult.rows;
      if (rows.length === 0) {
        return {
          content: [{ type: "text" as const, text: `未找到与 "${searchTerm}" 相关的深度研报文章。` }],
          details: { count: 0 },
        };
      }

      // If exact 1 match, return full text directly
      if (rows.length === 1) {
        const single = rows[0];
        const body = single.format === "html" ? htmlToReadableText(single.content_raw) : single.content_raw;
        const text = [
          `**${single.title}** (Slug: ${single.slug})`,
          single.published_at ? `Published: ${single.published_at}` : "",
          "",
          body,
        ].filter(Boolean).join("\n");
        return { content: [{ type: "text" as const, text }], details: { count: 1, slug: single.slug } };
      }

      // If multiple matches, return summary list with excerpts
      const items = rows.map((r) => {
        const desc = r.description ? `\n  *摘要: ${r.description}*` : "";
        return `- **${r.title}** (slug: \`${r.slug}\` · ${r.published_at ?? "最新"})${desc}`;
      });

      const text = [
        `### 找到以下 ${rows.length} 篇相关的 ${BRAND_EN} 深度洞见研报：`,
        ...items,
        "",
        `*提示: 如需某篇完整内容，可通过 \`get_insight_content(slug="...")\` 调取全文。*`,
      ].join("\n");

      return { content: [{ type: "text" as const, text }], details: { count: rows.length } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `搜索洞见文章失败: ${msg}` }], details: null };
    }
  },
});
