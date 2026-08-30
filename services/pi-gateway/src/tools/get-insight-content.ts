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

export const getInsightContentTool = defineTool({
  name: "get_insight_content",
  label: `Get ${BRAND_EN} Insight Article Content`,
  description:
    `Fetch the full text of a published ${BRAND_EN} insight article (/insights) by slug. Use this when the reader's question needs exact quotes, section detail, or specifics beyond the title already known from the session context.`,
  promptSnippet: "get_insight_content(slug) → full insight article text",
  parameters: Type.Object({
    slug: Type.String({ description: "Insight post slug, e.g. buffett-2025-letter-notes" }),
  }),
  async execute(_id, params, signal) {
    const { slug } = params;

    if (signal?.aborted) {
      return { content: [{ type: "text" as const, text: "Cancelled." }], details: null };
    }

    let row: InsightRow | undefined;
    try {
      const result = await pool.query<InsightRow>(
        `SELECT title, format, "contentRaw" AS content_raw, to_char("publishedAt", 'YYYY-MM-DD') AS published_at
         FROM "InsightPost"
         WHERE slug = $1 AND status = 'published'
         LIMIT 1`,
        [slug],
      );
      row = result.rows[0];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Failed to fetch insight article: ${msg}` }], details: null };
    }

    if (!row) {
      return {
        content: [{ type: "text" as const, text: `No published insight article found with slug "${slug}".` }],
        details: null,
      };
    }

    const body = row.format === "html" ? htmlToReadableText(row.content_raw) : row.content_raw;

    const text = [
      `**${row.title}**`,
      row.published_at ? `Published: ${row.published_at}` : "",
      "",
      body,
    ].filter((l) => l !== undefined).join("\n");

    return { content: [{ type: "text" as const, text }], details: { slug } };
  },
});
