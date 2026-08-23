import { describe, expect, it } from "vitest";
import { validateImageAttachments } from "./image-attachment.js";

describe("validateImageAttachments", () => {
  it("returns undefined when no images are given", () => {
    expect(validateImageAttachments(undefined)).toBeUndefined();
    expect(validateImageAttachments(null)).toBeUndefined();
    expect(validateImageAttachments([])).toBeUndefined();
  });

  it("passes through valid images", () => {
    const images = [{ mimeType: "image/jpeg", data: "abc123" }];
    expect(validateImageAttachments(images)).toEqual(images);
  });

  it("rejects a non-array value", () => {
    expect(() => validateImageAttachments({ mimeType: "image/jpeg", data: "abc" })).toThrow();
  });

  it("rejects too many images", () => {
    const images = Array.from({ length: 5 }, () => ({ mimeType: "image/jpeg", data: "abc" }));
    expect(() => validateImageAttachments(images)).toThrow("最多支持 4 张图片");
  });

  it("rejects an unsupported mime type", () => {
    expect(() => validateImageAttachments([{ mimeType: "image/svg+xml", data: "abc" }])).toThrow();
  });

  it("rejects an empty or oversized data field", () => {
    expect(() => validateImageAttachments([{ mimeType: "image/png", data: "" }])).toThrow();
    expect(() => validateImageAttachments([{ mimeType: "image/png", data: "a".repeat(8_000_001) }])).toThrow();
  });
});
