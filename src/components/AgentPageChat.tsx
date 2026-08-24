"use client";

import { AgentChat } from "@/components/AgentChat";
import { useAgentChat, type Message } from "@/hooks/useAgentChat";

interface AgentPageChatProps {
  initialMessages?: Message[];
}

export function AgentPageChat({ initialMessages }: AgentPageChatProps) {
  const { messages, input, setInput, streaming, sendMessage, abort, pendingImages, addImage, removeImage } =
    useAgentChat({ initialMessages });

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
