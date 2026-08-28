import type { ComponentPropsWithoutRef } from "react";

// Shared ReactMarkdown component overrides — used by both the chat message
// renderer (AgentChat) and the note editor's live preview (NoteEditor), so a
// note built from a chat reply renders identically in both places.
export const mdComponents = {
  a: (props: ComponentPropsWithoutRef<"a">) => {
    const href = props.href ?? "";
    const isExternal = /^https?:\/\//i.test(href);
    return (
      <a {...props} target={isExternal ? "_blank" : props.target} rel={isExternal ? "noopener noreferrer" : props.rel} />
    );
  },
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="msg-table-wrap">
      <table {...props} />
    </div>
  ),
};
