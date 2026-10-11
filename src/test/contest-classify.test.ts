import { describe, expect, test } from "bun:test";
import { isHighConfidenceContestWinner, sortContestResultsByWinProbability, type ContestClassification, type ContestCategory } from "../server/gmail/contest-classify";

function fixture(category: ContestCategory): ContestClassification {
  return {
    category,
    categoryProbabilities: {
      winner: category === "winner" ? 1 : 0,
      new_contest: category === "new_contest" ? 1 : 0,
      entry_confirmation: category === "entry_confirmation" ? 1 : 0,
      notification_update: category === "notification_update" ? 1 : 0,
      irrelevant: category === "irrelevant" ? 1 : 0,
    },
    confidence: 1,
    explicitWinProbability: category === "winner" ? 0.99 : 0.01,
    claimActionProbability: category === "winner" ? 0.95 : 0.01,
    model: "canned-fixture",
    promptVersion: "fixture-v1",
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

describe("winner eligibility policy", () => {
  test("requires winner category and explicit win probability at the threshold", () => {
    expect(isHighConfidenceContestWinner({ ...fixture("winner"), confidence: 0.1, explicitWinProbability: 0.9 })).toBe(true);
    expect(isHighConfidenceContestWinner({ ...fixture("winner"), confidence: 1, explicitWinProbability: 0.899 })).toBe(false);
    expect(isHighConfidenceContestWinner({ ...fixture("entry_confirmation"), explicitWinProbability: 1 })).toBe(false);
    expect(isHighConfidenceContestWinner({ ...fixture("winner"), explicitWinProbability: 0.8 }, 0.8)).toBe(true);
    for (const threshold of [-1, 2, NaN, Infinity]) expect(() => isHighConfidenceContestWinner(fixture("winner"), threshold)).toThrow(RangeError);
  });

  test("sorts by explicit win probability with stable ties without mutating input", () => {
    const low = { ...fixture("winner"), explicitWinProbability: 0.1 };
    const first = { ...fixture("winner"), explicitWinProbability: 0.9 };
    const second = { ...fixture("new_contest"), explicitWinProbability: 0.9 };
    const input = [low, first, second];
    expect(sortContestResultsByWinProbability(input)).toEqual([first, second, low]);
    expect(input).toEqual([low, first, second]);
  });
});
