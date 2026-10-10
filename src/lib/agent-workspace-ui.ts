export type NoteSaveStatus = "saving" | "saved" | "error";
export type AgentTurnRole = "user" | "assistant";

export interface AgentTurnPreview {
  role: AgentTurnRole;
  text: string;
}

export function summarizeConversationPreview(text: string, maxLength = 72): string {
  const normalized = text
    .replace(/```[\s\S]*?```/g, "代码内容")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(normalized);
  return characters.length > maxLength
    ? `${characters.slice(0, maxLength).join("")}…`
    : normalized;
}

export function getNoteSaveLabel(status: NoteSaveStatus): string {
  switch (status) {
    case "saving":
      return "保存中";
    case "saved":
      return "已保存";
    case "error":
      return "保存失败";
  }
}

export function getNextChatTabIndex(
  key: string,
  currentIndex: number,
  tabCount: number,
): number | null {
  if (tabCount < 1) return null;

  switch (key) {
    case "ArrowRight":
      return (currentIndex + 1) % tabCount;
    case "ArrowLeft":
      return (currentIndex - 1 + tabCount) % tabCount;
    case "Home":
      return 0;
    case "End":
      return tabCount - 1;
    default:
      return null;
  }
}
