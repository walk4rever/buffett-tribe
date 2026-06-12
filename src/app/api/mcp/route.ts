import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  searchParams, toolSearch,
  getDocumentParams, toolGetDocument,
} from "@/lib/mcp-tools";

export const maxDuration = 60;

function createServer() {
  const server = new McpServer({
    name: "buffett-tribe",
    version: "1.0.0",
  });

  server.tool(
    "search",
    `Search the Buffett Tribe knowledge base (1958–2025) using hybrid keyword + semantic retrieval.
Use this first when answering questions about Buffett's views, decisions, or writings.
Returns ranked passages with year, source type, and English/Chinese excerpts.
Combine with get_document to read the full context of a passage.
Source types: shareholder (annual letters 1965–2025), partnership (early partnership letters 1958–1970).`,
    searchParams.shape,
    async (params) => {
      const result = await toolSearch(params);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_document",
    `Retrieve the full content of a specific document from the Buffett Tribe knowledge base, paginated at 10 chunks per page.
Identify a document by sourceId (from search results) or by year + type.
Types: shareholder | partnership.
Use page parameter to read through long documents. Check totalPages in the response to know when you've reached the end.
Example: year=2023, type="shareholder" retrieves the 2023 Berkshire shareholder letter.`,
    getDocumentParams.shape,
    async (params) => {
      const result = await toolGetDocument(params);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  return server;
}

async function handler(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session management needed
  });
  const server = createServer();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
