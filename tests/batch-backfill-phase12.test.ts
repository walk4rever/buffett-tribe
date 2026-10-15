import { describe, expect, it } from "vitest";
import {
  parseBackfillArgs,
  sortCandidates,
  type EntityCandidate,
} from "../scripts/batch-backfill-phase12-financials";

describe("Phase 1 & Phase 2 批量财报回补参数与调度测试", () => {
  describe("1. parseBackfillArgs 参数解析与校验", () => {
    it("默认参数解析", () => {
      const opts = parseBackfillArgs([]);
      expect(opts.dryRun).toBe(false);
      expect(opts.force).toBe(false);
      expect(opts.resetCheckpoint).toBe(false);
      expect(opts.market).toBe("all");
      expect(opts.phase).toEqual([1, 2]);
      expect(opts.fromYear).toBe(2020);
      expect(opts.limit).toBeUndefined();
      expect(opts.offset).toBe(0);
      expect(opts.delayMs).toBe(500);
    });

    it("正确解析 --phase 2 与 --market us", () => {
      const opts = parseBackfillArgs(["--phase", "2", "--market", "us", "--dry-run"]);
      expect(opts.phase).toEqual([2]);
      expect(opts.market).toBe("us");
      expect(opts.dryRun).toBe(true);
    });

    it("正确解析 --phase 1 与 --reset-checkpoint", () => {
      const opts = parseBackfillArgs(["--phase", "1", "--reset-checkpoint", "--force"]);
      expect(opts.phase).toEqual([1]);
      expect(opts.resetCheckpoint).toBe(true);
      expect(opts.force).toBe(true);
    });

    it("遇到非法 phase 抛出异常", () => {
      expect(() => parseBackfillArgs(["--phase", "3"])).toThrow(/Invalid --phase value "3"/);
      expect(() => parseBackfillArgs(["--phase", "foo"])).toThrow(/Invalid --phase value "foo"/);
    });

    it("遇到非法 market 抛出异常", () => {
      expect(() => parseBackfillArgs(["--market", "uk"])).toThrow(/Invalid --market value "uk"/);
    });

    it("遇到未知参数阻断并抛出异常", () => {
      expect(() => parseBackfillArgs(["--unknown-flag"])).toThrow(/Unknown argument "--unknown-flag"/);
    });
  });

  describe("2. sortCandidates 排序算法", () => {
    it("严格遵循 Phase 2 优先 -> 市场顺序(US -> CN -> HK) -> Priority 倒序 -> Ticker 字母序", () => {
      const input: EntityCandidate[] = [
        { id: "1", ticker: "00700.HK", market: "hk", code: "00700", cik: null, canonicalName: "Tencent", onboardPhase: 2, priority: 10, reportingCurrency: "CNY" },
        { id: "2", ticker: "AAPL", market: "us", code: null, cik: "320193", canonicalName: "Apple", onboardPhase: 1, priority: 5, reportingCurrency: "USD" },
        { id: "3", ticker: "600519.SH", market: "cn", code: "600519", cik: null, canonicalName: "Kweichow Moutai", onboardPhase: 2, priority: 10, reportingCurrency: "CNY" },
        { id: "4", ticker: "MSFT", market: "us", code: null, cik: "789019", canonicalName: "Microsoft", onboardPhase: 2, priority: 0, reportingCurrency: "USD" },
        { id: "5", ticker: "AMZN", market: "us", code: null, cik: "1018724", canonicalName: "Amazon", onboardPhase: 2, priority: 5, reportingCurrency: "USD" },
        { id: "6", ticker: "600036.SH", market: "cn", code: "600036", cik: null, canonicalName: "CMB", onboardPhase: 1, priority: 0, reportingCurrency: "CNY" },
        { id: "7", ticker: "09988.HK", market: "hk", code: "09988", cik: null, canonicalName: "Alibaba", onboardPhase: 2, priority: 5, reportingCurrency: "CNY" },
      ];

      const sorted = sortCandidates(input);

      // Expected order:
      // Phase 2 US: AMZN (pri 5), MSFT (pri 0)
      // Phase 2 CN: 600519.SH (pri 10)
      // Phase 2 HK: 00700.HK (pri 10), 09988.HK (pri 5)
      // Phase 1 US: AAPL (pri 5)
      // Phase 1 CN: 600036.SH (pri 0)
      expect(sorted.map((c) => c.ticker)).toEqual([
        "AMZN",
        "MSFT",
        "600519.SH",
        "00700.HK",
        "09988.HK",
        "AAPL",
        "600036.SH",
      ]);
    });
  });
});
