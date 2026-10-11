import { describe, expect, test } from "bun:test";
import { estimateContestApiCost } from "../server/gmail/contest-cost";

describe("contest API cost estimate", () => {
  test("uses explicitly configured input and output rates without assumed vendor pricing", () => {
    expect(estimateContestApiCost(1_000_000, 1_000_000, {
      JEV_INPUT_USD_PER_MILLION_TOKENS: "2.5", JEV_OUTPUT_USD_PER_MILLION_TOKENS: "10",
    })).toBe(12.5);
    expect(estimateContestApiCost(500_000, 250_000, {
      JEV_INPUT_USD_PER_MILLION_TOKENS: "2", JEV_OUTPUT_USD_PER_MILLION_TOKENS: "8",
    })).toBe(3);
  });
  test("missing either rate is unknown rather than zero", () => {
    expect(estimateContestApiCost(1_000_000, 1_000_000, {})).toBeNull();
    expect(estimateContestApiCost(1_000_000, 1_000_000, { JEV_INPUT_USD_PER_MILLION_TOKENS: "2" })).toBeNull();
    expect(estimateContestApiCost(1_000_000, 1_000_000, { JEV_OUTPUT_USD_PER_MILLION_TOKENS: "8" })).toBeNull();
  });
  test.each(["", " ", "invalid", "NaN", "Infinity", "-1"])("invalid configured rate %s stays unknown", (rate) => {
    expect(estimateContestApiCost(1_000_000, 1_000_000, {
      JEV_INPUT_USD_PER_MILLION_TOKENS: rate, JEV_OUTPUT_USD_PER_MILLION_TOKENS: "8",
    })).toBeNull();
  });
  test("explicit zero rates and zero successful-response usage produce zero", () => {
    expect(estimateContestApiCost(1_000_000, 1_000_000, { JEV_INPUT_USD_PER_MILLION_TOKENS: "0", JEV_OUTPUT_USD_PER_MILLION_TOKENS: "0" })).toBe(0);
    expect(estimateContestApiCost(0, 0, { JEV_INPUT_USD_PER_MILLION_TOKENS: "2", JEV_OUTPUT_USD_PER_MILLION_TOKENS: "8" })).toBe(0);
  });
  test("invalid token counts or overflow cannot produce a fabricated estimate", () => {
    const rates = { JEV_INPUT_USD_PER_MILLION_TOKENS: "2", JEV_OUTPUT_USD_PER_MILLION_TOKENS: "8" };
    for (const input of [-1, 0.5, Infinity, NaN]) expect(estimateContestApiCost(input, 1, rates)).toBeNull();
    expect(estimateContestApiCost(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, { JEV_INPUT_USD_PER_MILLION_TOKENS: "1e308", JEV_OUTPUT_USD_PER_MILLION_TOKENS: "1e308" })).toBeNull();
  });
});
