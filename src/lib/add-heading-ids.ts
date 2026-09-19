import { unified } from "unified";
import rehypeParse from "rehype-parse";
import rehypeStringify from "rehype-stringify";
import type { Element } from "hast";
import { visit } from "unist-util-visit";
import GithubSlugger from "github-slugger";

/**
 * Add IDs to h2 and h3 headings in HTML content.
 * This is used server-side to prepare content before extracting headings.
 * Uses the same slugger as rehype-slug for consistency.
 * Adds 'user-content-' prefix to match rehype-slug's behavior.
 */
export async function addHeadingIds(html: string): Promise<string> {
  const slugger = new GithubSlugger();

  const file = await unified()
    .use(rehypeParse, { fragment: true })
    .use(() => (tree) => {
      visit(tree, "element", (node: Element) => {
        if (node.tagName === "h2" || node.tagName === "h3") {
          if (!node.properties) node.properties = {};
          if (!node.properties.id) {
            const text = extractText(node);
            // rehype-slug adds 'user-content-' prefix by default
            node.properties.id = `user-content-${slugger.slug(text)}`;
          }
        }
      });
    })
    .use(rehypeStringify)
    .process(html);

  return String(file);
}

function extractText(node: Element): string {
  let text = "";
  visit(node, "text", (textNode) => {
    if ("value" in textNode && typeof textNode.value === "string") {
      text += textNode.value;
    }
  });
  return text;
}
