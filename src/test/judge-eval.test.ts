import { describe, expect, test } from "bun:test";
import {
  runJudgeEval,
  type JudgeEvalTrial,
} from "../server/gmail/judge-eval";

function trial(
  overrides: Partial<JudgeEvalTrial> & Pick<JudgeEvalTrial, "ownerLabel">,
): JudgeEvalTrial {
  return {
    recommendedCategory: "priority",
    agreesWithFiling: true,
    malformed: false,
    ...overrides,
  };
}

describe("judge eval metrics", () => {
  test("scores holdout trials for accuracy and per-category recall", () => {
    const metrics = runJudgeEval([
      trial({ ownerLabel: "priority", recommendedCategory: "priority" }),
      trial({ ownerLabel: "priority", recommendedCategory: "archive" }),
      trial({ ownerLabel: "archive", recommendedCategory: "archive" }),
      trial({ ownerLabel: "review", recommendedCategory: "review" }),
    ]);
    expect(metrics.holdoutSize).toBe(4);
    expect(metrics.scored).toBe(4);
    expect(metrics.accuracy).toBe(0.75);
    expect(metrics.perCategory.priority.recall).toBe(0.5);
    expect(metrics.perCategory.priority.support).toBe(2);
    expect(metrics.perCategory.archive.recall).toBe(1);
    expect(metrics.perCategory.review.recall).toBe(1);
  });

  test("disagreement rate is share of non-malformed trials where agreesWithFiling is false", () => {
    const metrics = runJudgeEval([
      trial({ ownerLabel: "priority", agreesWithFiling: false }),
      trial({ ownerLabel: "archive", agreesWithFiling: true }),
      trial({ ownerLabel: "new", agreesWithFiling: false }),
      trial({ ownerLabel: "review", agreesWithFiling: null, malformed: true }),
    ]);
    expect(metrics.disagreementRate).toBe(2 / 3);
  });

  test("malformed-output rate counts malformed over holdout size", () => {
    const metrics = runJudgeEval([
      trial({ ownerLabel: "priority", malformed: true, recommendedCategory: null }),
      trial({ ownerLabel: "archive", recommendedCategory: "archive" }),
    ]);
    expect(metrics.malformedOutputRate).toBe(0.5);
    expect(metrics.scored).toBe(1);
    expect(metrics.skipped).toBe(1);
  });

  test("empty holdout yields zero rates", () => {
    const metrics = runJudgeEval([]);
    expect(metrics).toEqual({
      holdoutSize: 0,
      scored: 0,
      skipped: 0,
      accuracy: 0,
      disagreementRate: 0,
      malformedOutputRate: 0,
      perCategory: {
        priority: { precision: null, recall: null, support: 0 },
        review: { precision: null, recall: null, support: 0 },
        new: { precision: null, recall: null, support: 0 },
        archive: { precision: null, recall: null, support: 0 },
      },
      confusionMatrix: {
        priority: { priority: 0, review: 0, new: 0, archive: 0 },
        review: { priority: 0, review: 0, new: 0, archive: 0 },
        new: { priority: 0, review: 0, new: 0, archive: 0 },
        archive: { priority: 0, review: 0, new: 0, archive: 0 },
      },
    });
  });

  test("malformed trials do not contribute to confusion matrix or accuracy denominator", () => {
    const metrics = runJudgeEval([
      trial({
        ownerLabel: "priority",
        recommendedCategory: null,
        agreesWithFiling: null,
        malformed: true,
      }),
      trial({ ownerLabel: "priority", recommendedCategory: "priority" }),
    ]);
    expect(metrics.accuracy).toBe(1);
    expect(metrics.confusionMatrix.priority.priority).toBe(1);
  });
});
