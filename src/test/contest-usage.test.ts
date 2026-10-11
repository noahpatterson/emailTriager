import { describe, expect, test } from "bun:test";
import { addContestTokenUsage, MAX_CONTEST_MODEL_CALLS, MAX_CONTEST_RESPONSE_TOKENS, MAX_CONTEST_RUN_TOKENS } from "../server/gmail/contest-usage";

describe("contest token counters", () => {
  test("fifty maximum provider responses remain PostgreSQL integer values", () => {
    let total = { inputTokens: 0, outputTokens: 0 };
    for (let i = 0; i < MAX_CONTEST_MODEL_CALLS; i++) {
      const next = addContestTokenUsage(total, { inputTokens: MAX_CONTEST_RESPONSE_TOKENS, outputTokens: MAX_CONTEST_RESPONSE_TOKENS });
      expect(next).not.toBeNull();
      total = next!;
    }
    expect(total).toEqual({ inputTokens: 2_147_483_600, outputTokens: 2_147_483_600 });
  });
  test("rejects out-of-range provider counters instead of clamping or losing usage", () => {
    for (const counter of [MAX_CONTEST_RESPONSE_TOKENS + 1, Number.MAX_SAFE_INTEGER, -1, 0.5, Infinity]) {
      expect(addContestTokenUsage({ inputTokens: 0, outputTokens: 0 }, { inputTokens: counter, outputTokens: 0 })).toBeNull();
      expect(addContestTokenUsage({ inputTokens: 0, outputTokens: 0 }, { inputTokens: 0, outputTokens: counter })).toBeNull();
    }
  });
  test("checks cumulative totals independently at the database boundary", () => {
    expect(addContestTokenUsage({ inputTokens: MAX_CONTEST_RUN_TOKENS - 1, outputTokens: 0 }, { inputTokens: 1, outputTokens: 0 })).toEqual({ inputTokens: 2_147_483_647, outputTokens: 0 });
    expect(addContestTokenUsage({ inputTokens: MAX_CONTEST_RUN_TOKENS, outputTokens: 0 }, { inputTokens: 1, outputTokens: 0 })).toBeNull();
  });
});
