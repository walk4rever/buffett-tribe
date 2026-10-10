import { describe, expect, it } from "vitest";
import {
  getNextChatTabIndex,
  getNoteSaveLabel,
  type NoteSaveStatus,
} from "../src/lib/agent-workspace-ui";

describe("agent workspace UI helpers", () => {
  it.each([
    ["saving", "保存中"],
    ["saved", "已保存"],
    ["error", "保存失败"],
  ] satisfies Array<[NoteSaveStatus, string]>)(
    "labels note save status %s",
    (status, expected) => {
      expect(getNoteSaveLabel(status)).toBe(expected);
    },
  );

  it("wraps arrow-key navigation between chat tabs", () => {
    expect(getNextChatTabIndex("ArrowRight", 2, 3)).toBe(0);
    expect(getNextChatTabIndex("ArrowLeft", 0, 3)).toBe(2);
  });

  it("supports Home and End shortcuts", () => {
    expect(getNextChatTabIndex("Home", 2, 3)).toBe(0);
    expect(getNextChatTabIndex("End", 0, 3)).toBe(2);
  });

  it("ignores unrelated keys and empty tab lists", () => {
    expect(getNextChatTabIndex("Enter", 1, 3)).toBeNull();
    expect(getNextChatTabIndex("ArrowRight", 0, 0)).toBeNull();
  });
});
