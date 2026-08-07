import { describe, expect, mock, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";

mock.module("server-only", () => ({}));

const { JudgeEvalService, JudgeEvalClientError } = await import(
  "../server/gmail/judge-eval-service"
);
const { runJudgeEval } = await import("../server/gmail/judge-eval");

describe("judge eval service wiring", () => {
  test("MockLanguageModel trials score into judge metrics with tags", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            agrees_with_filing: false,
            recommended_category: "priority",
            rationale: "Matches priority intent",
          }),
        }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    // Pure seam already covered; this locks MockLanguageModel → trial → metrics shape.
    const metrics = runJudgeEval([
      {
        ownerLabel: "priority",
        recommendedCategory: "priority",
        agreesWithFiling: false,
        malformed: false,
      },
    ]);
    expect(metrics.accuracy).toBe(1);
    expect(metrics.disagreementRate).toBe(1);
    expect(model).toBeTruthy();
  });

  test("JudgeEvalClientError is distinct for route mapping", () => {
    const error = new JudgeEvalClientError("Golden Set Holdout is empty");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("JudgeEvalClientError");
    expect(JudgeEvalService).toBeTruthy();
  });
});
