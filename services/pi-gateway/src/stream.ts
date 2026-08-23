import type { Response } from "express";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ImageAttachment } from "./image-attachment.js";

// DeepSeek's vision model is a distinct model from the default text model
// (see services/pi-gateway/.pi-agent/models.json) — only switch to it for
// turns that actually carry an image, then switch back, so plain-text turns
// keep running on the default model's better-tested tool-calling behavior.
const VISION_MODEL_PROVIDER = "deepseek";
const VISION_MODEL_ID = "deepseek-v4-flash-vision-exp";

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
    sse(res, "done", {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sse(res, "error", { message });
  } finally {
    if (visionModel && originalModel) await session.setModel(originalModel);
    unsubscribe();
    res.end();
  }
}
