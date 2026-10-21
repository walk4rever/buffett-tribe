import { describe, expect, it } from "vitest";

import { classifyOnboardError } from "../src/lib/onboard-error";

describe("classifyOnboardError", () => {
  it.each([
    ["Failed: Invalid canvas", "内容画布校验失败"],
    ["Cannot resolve currency: FilingSection text is empty", "年报切片/币种解析失败"],
    ["Created 0 ExtSource records", "未找到年报"],
    ["CompanyFacts fetch failed: HTTP 404", "SEC 财务事实 404"],
    ["SEC fetch failed: 503", "SEC 网络错误"],
    ["statement timeout 57014", "数据库超时/连接失败"],
    ["import-stock-prices-from-file exited with code 1", "股价导入失败"],
  ])("classifies %s", (message, expected) => {
    expect(classifyOnboardError(message)).toBe(expected);
  });

  it("falls back to a neutral category", () => {
    expect(classifyOnboardError("process exited with code 1")).toBe("阶段执行失败");
    expect(classifyOnboardError(null)).toBe("阶段执行失败");
  });
});
