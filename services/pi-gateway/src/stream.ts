import type { Response } from "express";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ImageAttachment } from "./image-attachment.js";

// DeepSeek's vision model is a distinct model from the default text model
// (see services/pi-gateway/.pi-agent/models.json) — only switch to it for
// turns that actually carry an image, then switch back, so plain-text turns
// keep running on the default model's better-tested tool-calling behavior.
const VISION_MODEL_PROVIDER = "deepseek";
const VISION_MODEL_ID = "deepseek-v4-flash-vision-exp";

// A turn can go fully silent for ~30s while the model reasons between the last
// tool result and the final answer (measured on a 5-tool-round question). Nothing
// in the chain distinguishes that from a dead connection, so emit an SSE comment
// periodically to keep intermediaries from reaping an "idle" stream. Comment lines
// are ignored by the client's parser, which only reads `event:`/`data:` prefixes.
const HEARTBEAT_MS = 15_000;

function sse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function streamPrompt(
  session: AgentSession,
  message: string,
  res: Response,
  contextPrefix?: string,
  images?: ImageAttachment[],
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

  // The agent loop ends a turn without complaint when the provider reports
  // finish_reason "length" (max_tokens exhausted mid-generation) — the text just
  // stops. Track the last turn's stop reason so `done` can tell the client the
  // answer is cut off rather than finished.
  let lastStopReason: string | undefined;

  // Between a tool batch finishing and the next answer starting, the model can
  // reason for ~30s without emitting a single byte. `turn_start` fires right before
  // each provider request, so it's the precise moment to tell the client "still
  // working" — and whether tools have already run distinguishes the opening think
  // from digesting query results.
  let toolsRan = false;

  const unsubscribe = session.subscribe((event) => {
    switch (event.type) {
      case "turn_start":
        sse(res, "phase", { phase: toolsRan ? "synthesizing" : "thinking" });
        break;
      case "turn_end":
        if (event.message.role === "assistant") lastStopReason = event.message.stopReason;
        break;
      case "message_update": {
        const ae = event.assistantMessageEvent;
        if (ae.type === "text_delta") {
          sse(res, "delta", { text: ae.delta });
        }
        break;
      }
      case "tool_execution_start":
        toolsRan = true;
        sse(res, "tool_start", { id: event.toolCallId, name: event.toolName, args: event.args });
        break;
      case "tool_execution_end": {
        const details = (event.result as { details?: unknown } | null)?.details ?? null;
        sse(res, "tool_end", { id: event.toolCallId, name: event.toolName, error: event.isError, details });
        break;
      }
    }
  });

  const promptText = contextPrefix ? `${contextPrefix}\n\n${message}` : message;

  const originalModel = session.model;
  const visionModel = images?.length
    ? session.modelRegistry.find(VISION_MODEL_PROVIDER, VISION_MODEL_ID)
    : undefined;
  if (visionModel) await session.setModel(visionModel);

  try {
    await session.prompt(
      promptText,
      images?.length
        ? { images: images.map((img) => ({ type: "image" as const, mimeType: img.mimeType, data: img.data })) }
        : undefined,
    );
    sse(res, "done", { truncated: lastStopReason === "length" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sse(res, "error", { message });
  } finally {
    clearInterval(heartbeat);
    if (visionModel && originalModel) await session.setModel(originalModel);
    unsubscribe();
    res.end();
  }
}
