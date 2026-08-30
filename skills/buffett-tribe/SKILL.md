---
name: buffett-tribe
description: >
  Query the Warren Buffett knowledge base (1958–2025) via REST API — shareholder letters
  and partnership letters. Use this skill whenever the user asks
  about Buffett's views, investment decisions, principles, or history; wants to read a specific
  letter; or asks questions like "what did Buffett say about X", "when did Berkshire buy Y",
  "how has Buffett's view on Z changed over time", or anything related to value investing,
  Berkshire Hathaway, or Buffett's writings. Call the API with curl — no authentication needed.
---

# Buffett Tribe

Access 60+ years of Warren Buffett's public writings and speeches via three REST endpoints.
Always call the API with `curl` — responses are JSON.

**Base URL:** `https://vt.air7.fun/api/tools`

## Data coverage

| Type | Years | Description |
|------|-------|-------------|
| `shareholder` | 1965–2025 | Annual letters to Berkshire shareholders (61 letters) |
| `partnership` | 1958–1970 | Early partnership letters (33 letters) |

---

## 1. search — find relevant passages

Use this first for almost every question. It runs hybrid keyword + semantic retrieval and returns the most relevant passages.

```bash
curl "https://vt.air7.fun/api/tools/search?q=QUERY&yearFrom=YYYY&yearTo=YYYY&limit=N"
```

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `q` | ✅ | — | Question or topic (any language) |
| `yearFrom` | ❌ | all | Earliest year, inclusive |
| `yearTo` | ❌ | all | Latest year, inclusive |
| `limit` | ❌ | 7 | Results to return (max 20) |

**Response:** `{ found, chunks[] }` — each chunk has `year`, `sourceType`, `title`, `excerpt` (English), `excerptZh` (Chinese).

---

## 2. document — read a full document

Use when the user wants to read a specific letter in full, or when you need more context than the excerpts provide. Documents are paginated at 10 chunks per page — check `totalPages` and fetch additional pages as needed.

```bash
# By year + type
curl "https://vt.air7.fun/api/tools/document?year=2008&type=shareholder&page=1"

# By sourceId (from search results)
curl "https://vt.air7.fun/api/tools/document?sourceId=ID&page=2"
```

| Param | Required | Description |
|-------|----------|-------------|
| `sourceId` | ❌ | Exact source ID (from search chunk) |
| `year` | ❌ | Document year |
| `type` | ❌ | `shareholder` \| `partnership` |
| `page` | ❌ | Page number (default 1, 10 chunks/page) |

**Response:** `{ source: { id, year, type, title }, chunks[], page, totalPages, totalChunks }`

---

## 3. graph — entity relationships

Use to explore structured relationships from the knowledge graph — what companies Berkshire held, when, and what Buffett said about them.

```bash
curl "https://vt.air7.fun/api/tools/graph?entity=ENTITY&yearFrom=YYYY&yearTo=YYYY&limit=12"
```

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `entity` | ✅ | — | Company, concept, or person name |
| `yearFrom` | ❌ | all | Earliest year |
| `yearTo` | ❌ | all | Latest year |
| `limit` | ❌ | 12 | Max relationships (max 20) |

**Response:** `{ entity, found, relationships[] }` — each relationship has `from`, `relation`, `to`, `year`, `quote`.

---

## Workflow

**For most questions** → `search` is sufficient. Synthesize the returned excerpts into an answer.

**For timeline questions** ("when did...", "how has X changed over the years") → `search` with a year range, or no year filter to get all periods.

**For reading a specific letter** → `document` with `year` + `type`.

**For structured facts** ("what companies did Berkshire hold", "when did Buffett first mention X") → `graph` for entity relationships, or `search` with specific entities.

**Combining tools:** search first to find relevant chunks and their `sourceId`, then use `document` to read the full context of the most relevant source.

---

## Examples

```bash
# What did Buffett say about economic moats?
curl "https://vt.air7.fun/api/tools/search?q=economic+moat+competitive+advantage"

# How has Buffett's view on technology companies changed over time?
curl "https://vt.air7.fun/api/tools/search?q=technology+companies+investment&limit=15"

# Read the 2008 shareholder letter (during the financial crisis)
curl "https://vt.air7.fun/api/tools/document?year=2008&type=shareholder"

# When did Berkshire hold Apple, and what did Buffett say?
curl "https://vt.air7.fun/api/tools/graph?entity=Apple"

# What did Buffett say about leverage and debt between 2000-2020?
curl "https://vt.air7.fun/api/tools/search?q=leverage+debt+risk&yearFrom=2000&yearTo=2020"

# Find all mentions of insurance float across all years
curl "https://vt.air7.fun/api/tools/search?q=insurance+float&limit=20"
```
