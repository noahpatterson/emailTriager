import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import {
  MAX_VERDICT_RATIONALE_CHARS,
  judgeMessage,
  verdictSchema,
  type JudgeModelTags,
} from "../server/gmail/judge";

const TAGS: JudgeModelTags = {
  model: "mock-model",
  provider: "mock-provider",
  promptVersion: "pv-1",
};

function mockModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "mock-provider",
    modelId: "mock-model",
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe("verdictSchema", () => {
  test("accepts a valid verdict", () => {
    const parsed = verdictSchema.parse({
      agrees_with_filing: false,
      recommended_category: "review",
      rationale: "Should be review",
    });
    expect(parsed.recommended_category).toBe("review");
  });

  test(`rejects rationale over ${MAX_VERDICT_RATIONALE_CHARS} chars`, () => {
    expect(() =>
      verdictSchema.parse({
        agrees_with_filing: true,
        recommended_category: "archive",
        rationale: "x".repeat(MAX_VERDICT_RATIONALE_CHARS + 1),
      }),
    ).toThrow();
  });
});

describe("judgeMessage", () => {
  test("persists structured fields and run tags on success", async () => {
    const result = await judgeMessage({
      model: mockModel(
        JSON.stringify({
          agrees_with_filing: true,
          recommended_category: "priority",
          rationale: "Matches priority intent",
        }),
      ),
      system: "system",
      user: "user",
      tags: TAGS,
    });
    expect(result).toEqual({
      agreesWithFiling: true,
      recommendedCategory: "priority",
      rationale: "Matches priority intent",
      malformed: false,
      model: "mock-model",
      provider: "mock-provider",
      promptVersion: "pv-1",
    });
  });

  test("flags malformed output and continues with null recommendation", async () => {
    const result = await judgeMessage({
      model: mockModel("not-json"),
      system: "system",
      user: "user",
      tags: TAGS,
    });
    expect(result.malformed).toBe(true);
    expect(result.agreesWithFiling).toBeNull();
    expect(result.recommendedCategory).toBeNull();
    expect(result.rationale).toBeNull();
    expect(result.model).toBe("mock-model");
    expect(result.provider).toBe("mock-provider");
    expect(result.promptVersion).toBe("pv-1");
  });

  test("flags schema-invalid category as malformed", async () => {
    const result = await judgeMessage({
      model: mockModel(
        JSON.stringify({
          agrees_with_filing: true,
          recommended_category: "blocked",
          rationale: "nope",
        }),
      ),
      system: "system",
      user: "user",
      tags: TAGS,
    });
    expect(result.malformed).toBe(true);
    expect(result.recommendedCategory).toBeNull();
  });
});
