"use client";

import { AgentChat } from "@/components/AgentChat";
import { WorkspaceSidebar } from "@/components/agent-workspace/WorkspaceSidebar";
import { NoteEditor } from "@/components/agent-workspace/NoteEditor";
import { useAgentChat, type Message } from "@/hooks/useAgentChat";
import { useNotes } from "@/hooks/useNotes";

interface AgentPageChatProps {
  initialMessages?: Message[];
}

export function AgentPageChat({ initialMessages }: AgentPageChatProps) {
  const { messages, input, setInput, streaming, sendMessage, abort, pendingImages, addImage, removeImage } =
    useAgentChat({ initialMessages });

  const { notes, activeNote, draft, openNote, closeEditor, createNote, updateDraft, deleteNote, saveAsNote } =
    useNotes();

  return (
    <div className="agent-workspace">
      <aside className="agent-workspace-sidebar">
        <WorkspaceSidebar
          notes={notes}
          activeNoteId={activeNote?.id ?? null}
          onOpenNote={openNote}
          onCreateNote={() => void createNote()}
        />
      </aside>

      <div className="agent-workspace-main">
        {activeNote && draft ? (
          <NoteEditor
            key={activeNote.id}
            title={draft.title}
            content={draft.content}
            onChangeTitle={(title) => updateDraft({ title })}
            onChangeContent={(content) => updateDraft({ content })}
            onClose={closeEditor}
            onDelete={() => void deleteNote(activeNote.id)}
          />
        ) : (
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
            onSaveAsNote={(text) => void saveAsNote(text)}
          />
        )}
      </div>
    </div>
  );
}
