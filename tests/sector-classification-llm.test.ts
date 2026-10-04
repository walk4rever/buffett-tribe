import { describe, expect, it } from "vitest";
import {
  SECTOR_CLASSIFY_PROMPT_VERSION,
  buildSectorClassificationPrompt,
  buildSectorEvidenceText,
  formatFingerprintLines,
  parseSectorClassification,
  type SectorEvidence,
} from "../src/lib/sector-classification-llm";
import { SECTOR_MODEL_13_TYPES } from "../src/lib/sector-classification";
import { computeSectorFingerprint } from "../src/lib/sector-fingerprint";

const evidence: SectorEvidence = {
  ticker: "000032.SZ",
  market: "cn",
  name: "深桑达A",
  nameZh: null,
  cik: null,
  sectorRaw: "Information Technology",
  industry: "高科技产业工程服务",
  exchange: "SZSE",
  overview:
    "为中国电子旗下企业，属建筑安装业，核心业务为高科技产业工程服务与数字信息服务，项目制收入为主。",
  fingerprint: computeSectorFingerprint([
    { periodEnd: "2026-12-31", periodType: "FY", lineItem: "Revenue", value: 49_170_000_000 },
    { periodEnd: "2026-12-31", periodType: "FY", lineItem: "NetIncome", value: 1_080_000_000 },
    { periodEnd: "2026-12-31", periodType: "FY", lineItem: "TotalAssets", value: 80_000_000_000 },
    { periodEnd: "2026-12-31", periodType: "FY", lineItem: "TotalLiabilities", value: 60_000_000_000 },
  ]),
};

describe("parseSectorClassification", () => {
  it("接受合法分类结果", () => {
    const result = parseSectorClassification(
      '{"type":"industrial","confidence":0.88,"reason":"属建筑安装业，项目制收入","evidence_used":["overview","fingerprint"]}',
    );
    expect(result.outcome).toBe("classified");
    expect(result.type).toBe("industrial");
    expect(result.confidence).toBe(0.88);
    expect(result.needsReview).toBe(false);
    expect(result.evidenceUsed).toEqual(["overview", "fingerprint"]);
  });

  it("接受 unknown，且不判为需要复核", () => {
    const result = parseSectorClassification('{"type":"unknown","confidence":0.9,"reason":"仅名称与代码，无业务信息"}');
    expect(result.outcome).toBe("unknown");
    expect(result.type).toBeNull();
    expect(result.needsReview).toBe(false);
  });

  it("容忍 Markdown 代码块与前后废话", () => {
    const result = parseSectorClassification(
      '分析如下：\n```json\n{"type": "banks", "confidence": 0.91, "reason": "净息差驱动"}\n```\n以上。',
    );
    expect(result.type).toBe("banks");
  });

  it("容忍大小写与 evidence_used 的驼峰写法", () => {
    const result = parseSectorClassification('{"type":"CAPITAL_MARKETS","confidence":0.8,"reason":"x","evidenceUsed":["overview"]}');
    expect(result.type).toBe("capital_markets");
    expect(result.evidenceUsed).toEqual(["overview"]);
  });

  it("非法类型抛错，而不是兜底到某类", () => {
    expect(() => parseSectorClassification('{"type":"technology","confidence":0.9,"reason":"x"}')).toThrow(/不在 13 类之内/);
    expect(() => parseSectorClassification('{"type":"financials","confidence":0.9,"reason":"x"}')).toThrow(/不在 13 类之内/);
  });

  it("无法解析为 JSON 时抛错", () => {
    expect(() => parseSectorClassification("我认为它是工业类")).toThrow(/无法解析/);
  });

  it("缺 confidence 时取 0.5 并进复核队列", () => {
    const result = parseSectorClassification('{"type":"utilities","reason":"受监管特许经营"}');
    expect(result.confidence).toBe(0.5);
    expect(result.needsReview).toBe(true);
  });

  it("confidence 超范围时被夹到 [0,1]", () => {
    expect(parseSectorClassification('{"type":"utilities","confidence":1.7,"reason":"x"}').confidence).toBe(1);
    expect(parseSectorClassification('{"type":"utilities","confidence":-3,"reason":"x"}').confidence).toBe(0);
  });

  it("reason 缺失时降级置信度（零幻觉审计线索不可省）", () => {
    const result = parseSectorClassification('{"type":"real_estate","confidence":0.95}');
    expect(result.confidence).toBe(0.5);
    expect(result.needsReview).toBe(true);
  });

  it("低于阈值的置信度标记为需要复核", () => {
    const result = parseSectorClassification('{"type":"conglomerate","confidence":0.66,"reason":"多元业务"}');
    expect(result.needsReview).toBe(true);
  });
});

describe("buildSectorClassificationPrompt", () => {
  const prompt = buildSectorClassificationPrompt(evidence);

  it("system prompt 包含全部 13 类的 key 与定义", () => {
    for (const type of SECTOR_MODEL_13_TYPES) {
      expect(prompt.system).toContain(`${type}（`);
    }
  });

  it("system prompt 写明关键边界裁决", () => {
    expect(prompt.system).toContain("支付网络");
    expect(prompt.system).toContain("物业管理");
    expect(prompt.system).toContain("管理式医疗");
    expect(prompt.system).toContain("unknown");
  });

  it("user prompt 带上概览与财务指纹", () => {
    expect(prompt.user).toContain("深桑达A");
    expect(prompt.user).toContain("属建筑安装业");
    expect(prompt.user).toContain("财务指纹");
    expect(prompt.user).toContain("491.7 亿");
  });

  it("prompt 版本号参与缓存失效", () => {
    expect(SECTOR_CLASSIFY_PROMPT_VERSION).toMatch(/^sector13-v/);
  });
});

describe("buildSectorEvidenceText", () => {
  it("无概览时明确写（无），不留空", () => {
    const text = buildSectorEvidenceText({ ...evidence, overview: null });
    expect(text).toContain("（无）");
  });

  it("无财务数据时明确写无可用财务数据", () => {
    expect(formatFingerprintLines({ ...evidence.fingerprint, periodLabel: null })).toEqual(["财务指纹：无可用财务数据"]);
  });

  it("缺失的比率不会以 null 形式出现在证据里", () => {
    const text = buildSectorEvidenceText(evidence);
    expect(text).not.toContain("null");
  });
});
