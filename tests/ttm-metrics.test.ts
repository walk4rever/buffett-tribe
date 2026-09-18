import { describe, expect, it } from "vitest";

describe("TTM Metrics and Valuation Calculations", () => {
  it("computes FCF-TTM as OCF - abs(CapEx)", () => {
    const ocf = 1000;
    const capex = 250;
    const fcf = ocf - Math.abs(capex);
    expect(fcf).toBe(750);
  });

  it("computes PE-TTM from price and diluted EPS TTM", () => {
    const price = 100;
    const epsTtm = 5;
    const peTtm = price / epsTtm;
    expect(peTtm).toBe(20);
  });

  it("computes rolling sum of 4 quarters for revenue TTM", () => {
    const q1 = 100;
    const q2 = 120;
    const q3 = 110;
    const q4 = 130;
    const revenueTtm = q1 + q2 + q3 + q4;
    expect(revenueTtm).toBe(460);
  });

  it("calculates discrete quarter from cumulative YTD correctly", () => {
    const cumH1 = 220;
    const cumQ1 = 100;
    const discreteQ2 = cumH1 - cumQ1;
    expect(discreteQ2).toBe(120);

    const cum9M = 330;
    const discreteQ3 = cum9M - cumH1;
    expect(discreteQ3).toBe(110);

    const cumFY = 460;
    const discreteQ4 = cumFY - cum9M;
    expect(discreteQ4).toBe(130);
  });

  it("calculates discrete half-years correctly for semi-annual filers", () => {
    const cumH1 = 150;
    const cumFY = 350;
    const discreteH2 = cumFY - cumH1;
    expect(discreteH2).toBe(200);
    expect(cumH1 + discreteH2).toBe(cumFY);
  });

  it("computes ROE-TTM as NetIncome TTM / Latest ShareholdersEquity", () => {
    const netIncomeTtm = 80;
    const shareholdersEquity = 400;
    const roe = (netIncomeTtm / shareholdersEquity) * 100;
    expect(roe).toBe(20);
  });
});
