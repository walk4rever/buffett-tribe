import { describe, expect, it } from "vitest";
import {
  resolveShareholdersCommonEquity,
  resolveShareholdersEquity,
  resolveTotalEquity,
} from "@/lib/equity-semantics";

describe("equity semantics", () => {
  it("derives common equity only from explicit preferred instruments", () => {
    expect(
      resolveShareholdersCommonEquity({
        ShareholdersEquity: 1_000,
        PreferredStockValue: 100,
      }),
    ).toBe(900);
    expect(
      resolveShareholdersCommonEquity({
        ShareholdersEquity: 1_000,
      }),
    ).toBeNull();
  });

  it("rejects direct common equity above parent equity", () => {
    expect(
      resolveShareholdersCommonEquity(
        {
          ShareholdersEquity: 1_000,
          ShareholdersCommonEquity: 1_100,
        },
        {
          ShareholdersEquity: "USD",
          ShareholdersCommonEquity: "USD",
        },
      ),
    ).toBeNull();
  });

  it("derives total equity from parent equity and minority interest", () => {
    expect(
      resolveTotalEquity({
        ShareholdersEquity: 1_000,
        MinorityInterest: 200,
      }),
    ).toBe(1_200);
    expect(
      resolveTotalEquity(
        {
          ShareholdersEquity: 1_000,
          MinorityInterest: 200,
        },
        {
          ShareholdersEquity: "USD",
          MinorityInterest: "EUR",
        },
      ),
    ).toBeNull();
  });

  it("repairs parent equity mistakenly populated with consolidated equity", () => {
    expect(
      resolveShareholdersEquity({
        ShareholdersEquity: 1_200,
        TotalEquity: 1_200,
        MinorityInterest: 200,
      }),
    ).toBe(1_000);
  });
});
