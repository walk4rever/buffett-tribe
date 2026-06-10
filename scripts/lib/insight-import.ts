import * as path from "path";
import {
  isInsightFormat,
  normalizeInsightSlug,
  normalizeInsightLegacyCallouts,
  parseInsightFrontmatter,
  type InsightFormat,
} from "../../src/lib/insights";

export const VALID_INSIGHT_STATUSES = ["draft", "published", "archived"] as const;
export type InsightStatus = (typeof VALID_INSIGHT_STATUSES)[number];

export interface InsightImportArgs {
  filePath: string;
  dryRun: boolean;
  title?: string;
  slug?: string;
  description?: string;
  source?: string;
  sourceUrl?: string;
  author?: string;
  date?: string;
  tags?: string[];
  status: InsightStatus;
  externalId?: string;
  format: InsightFormat;
}

export interface InsightImportData {
  slug: string;
  title: string;
  description: string | null;
  source: string | null;
  sourceUrl: string | null;
  author: string | null;
  publishedAt: Date | null;
  tags: string[];
  format: InsightFormat;
  contentRaw: string;
  contentHtml: string | null;
  status: InsightStatus;
  externalId: string | null;
}

export function parseInsightImportArgs(argv: string[]): InsightImportArgs {
  const filePath = readOptionalArg(argv, "--file") ?? firstPositionalArg(argv);
  if (!filePath) {
    throw new Error(`Missing file path.\n${getInsightImportUsage()}`);
  }

  const formatInput = readOptionalArg(argv, "--format") ?? "markdown";
  if (!isInsightFormat(formatInput)) {
    throw new Error(`Invalid --format "${formatInput}". Expected markdown or html.`);
  }

  const statusInput = readOptionalArg(argv, "--status") ?? "published";
  if (!isInsightStatus(statusInput)) {
    throw new Error(`Invalid --status "${statusInput}". Expected draft, published, or archived.`);
  }

  return {
    filePath,
    dryRun: argv.includes("--dry-run"),
    title: readOptionalArg(argv, "--title"),
    slug: readOptionalArg(argv, "--slug"),
    description: readOptionalArg(argv, "--description"),
    source: readOptionalArg(argv, "--source"),
    sourceUrl: readOptionalArg(argv, "--source-url"),
    author: readOptionalArg(argv, "--author"),
    date: readOptionalArg(argv, "--date") ?? readOptionalArg(argv, "--published-at"),
    tags: parseTags(readOptionalArg(argv, "--tags")),
    status: statusInput,
    externalId: readOptionalArg(argv, "--external-id"),
    format: formatInput,
  };
}

export function buildInsightImportData(rawContent: string, args: InsightImportArgs): InsightImportData {
  const parsed = args.format === "markdown"
    ? parseInsightFrontmatter(rawContent)
    : { content: rawContent, metadata: {} };

  const title = args.title ?? parsed.metadata.title ?? inferTitleFromFilePath(args.filePath);
  const slug = normalizeInsightSlug(args.slug ?? title);
  if (!slug) {
    throw new Error("Slug is invalid. Pass --slug or use a title with letters/numbers.");
  }

  const metadataSource = parsed.metadata.source;
  const metadataSourceIsUrl = isHttpUrl(metadataSource);
  const dateInput = args.date ?? parsed.metadata.date;

  return {
    slug,
    title,
    description: args.description ?? parsed.metadata.description ?? null,
    source: args.source ?? (metadataSourceIsUrl ? null : metadataSource ?? null),
    sourceUrl: args.sourceUrl ?? parsed.metadata.sourceUrl ?? (metadataSourceIsUrl ? metadataSource : null),
    author: args.author ?? parsed.metadata.author ?? null,
    publishedAt: parseDate(dateInput),
    tags: normalizeTags(args.tags ?? parsed.metadata.tags),
    format: args.format,
    contentRaw: normalizeInsightLegacyCallouts(parsed.content),
    contentHtml: null,
    status: args.status,
    externalId: args.externalId ?? null,
  };
}

export function getInsightImportUsage(): string {
  return [
    "Usage:",
    "  npm run import:insight -- --file <path.md> [options]",
    "  npm run import:insight -- <path.md> [options]",
    "",
    "Options:",
    "  --title <title>             Override frontmatter title",
    "  --slug <slug>               Override generated slug",
    "  --description <text>        Override frontmatter description",
    "  --source <name>             Source display name, e.g. \"Invest Like the Best\"",
    "  --source-url <url>          Source URL",
    "  --author <name>             Author",
    "  --date <yyyy-mm-dd>         Published date",
    "  --tags <a,b,c>              Comma-separated tags",
    "  --status <status>           draft, published, or archived",
    "  --external-id <id>          Upsert by externalId instead of slug",
    "  --format <format>           markdown or html",
    "  --dry-run                   Print parsed data without writing",
  ].join("\n");
}

function readOptionalArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value.trim() || undefined;
}

function firstPositionalArg(argv: string[]): string | undefined {
  return argv.find((arg, index) => {
    if (arg.startsWith("--")) return false;
    const previous = argv[index - 1];
    return !previous?.startsWith("--");
  });
}

function parseTags(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeTags(value: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? [])
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 16),
    ),
  );
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date "${value}".`);
  }
  return date;
}

function inferTitleFromFilePath(filePath: string): string {
  const basename = path.basename(filePath, path.extname(filePath)).trim();
  const withoutIndexPrefix = basename.replace(/^[A-Za-z]{1,4}\d+\s+/, "").trim();
  if (!withoutIndexPrefix) {
    throw new Error("Title is required. Add frontmatter title or pass --title.");
  }
  return withoutIndexPrefix;
}

function isInsightStatus(value: string): value is InsightStatus {
  return (VALID_INSIGHT_STATUSES as readonly string[]).includes(value);
}

function isHttpUrl(value: string | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}
