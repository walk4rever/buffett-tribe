"use client";

import { AgentChat } from "@/components/AgentChat";
import { useAgentChat } from "@/hooks/useAgentChat";

export function AgentPageChat() {
  const { messages, input, setInput, streaming, sendMessage, abort, pendingImages, addImage, removeImage } =
    useAgentChat();

  return (
    <AgentChat
      messages={messages}
      input={input}
      setInput={setInput}
      streaming={streaming}
      sendMessage={sendMessage}
      abort={abort}
      pendingImages={pendingImages}
      onAddImage={addImage}
      onRemoveImage={removeImage}
    />
  );
}
