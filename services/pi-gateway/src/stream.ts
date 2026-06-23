import type { Response } from "express";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

function sse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function streamPrompt(session: AgentSession, message: string, res: Response): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const unsubscribe = session.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        const ae = event.assistantMessageEvent;
        if (ae.type === "text_delta") {
          sse(res, "delta", { text: ae.delta });
        }
        break;
      }
      case "tool_execution_start":
        sse(res, "tool_start", { id: event.toolCallId, name: event.toolName, args: event.args });
        break;
      case "tool_execution_end": {
        const details = (event.result as { details?: unknown } | null)?.details ?? null;
        sse(res, "tool_end", { id: event.toolCallId, name: event.toolName, error: event.isError, details });
        break;
      }
    }
  });

  try {
    await session.prompt(message);
    sse(res, "done", {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sse(res, "error", { message });
  } finally {
    unsubscribe();
    res.end();
  }
}
