import { describe, expect, test } from "bun:test";
import type { Category } from "../server/gmail/corpus";
import {
  DEFAULT_EXEMPLARS_PER_CATEGORY,
  DEFAULT_PROMPT_BODY_CHARS,
  assembleJudgePrompt,
  selectExemplarsByCategory,
  truncatePromptBody,
  type ExemplarSnippet,
  type JudgePromptMessage,
} from "../server/gmail/judge-prompt";

function exemplar(
  overrides: Partial<ExemplarSnippet> & Pick<ExemplarSnippet, "ownerLabel">,
): ExemplarSnippet {
  return {
    id: "ex-1",
    from: "a@example.com",
    subject: "subj",
    bodyText: "body",
    ...overrides,
  };
}

describe("truncatePromptBody", () => {
  test("keeps short bodies unchanged", () => {
    expect(truncatePromptBody("hello", 4000)).toBe("hello");
  });

  test("truncates from the start to the default window", () => {
    const body = "x".repeat(DEFAULT_PROMPT_BODY_CHARS + 50);
    expect(truncatePromptBody(body)).toBe("x".repeat(DEFAULT_PROMPT_BODY_CHARS));
    expect(truncatePromptBody(body).length).toBe(DEFAULT_PROMPT_BODY_CHARS);
  });
});

describe("selectExemplarsByCategory", () => {
  test(`takes up to ${DEFAULT_EXEMPLARS_PER_CATEGORY} per category in stable order`, () => {
    const pool: ExemplarSnippet[] = [
      exemplar({ id: "p1", ownerLabel: "priority" }),
      exemplar({ id: "p2", ownerLabel: "priority" }),
      exemplar({ id: "p3", ownerLabel: "priority" }),
      exemplar({ id: "r1", ownerLabel: "review" }),
      exemplar({ id: "a1", ownerLabel: "archive" }),
      exemplar({ id: "a2", ownerLabel: "archive" }),
    ];
    const selected = selectExemplarsByCategory(pool);
    expect(selected.priority.map((e) => e.id)).toEqual(["p1", "p2"]);
    expect(selected.review.map((e) => e.id)).toEqual(["r1"]);
    expect(selected.new).toEqual([]);
    expect(selected.archive.map((e) => e.id)).toEqual(["a1", "a2"]);
  });

  test("ignores unknown labels and empty pool", () => {
    expect(selectExemplarsByCategory([])).toEqual({
      priority: [],
      review: [],
      new: [],
      archive: [],
    });
  });
});

describe("assembleJudgePrompt", () => {
  const intents = {
    priority: "Needs owner today",
    review: "Needs a considered reply",
    new: "First contact from a stranger",
    archive: "Noise or done",
  };

  const cases: ReadonlyArray<{
    name: string;
    message: JudgePromptMessage;
    expectOutcomeInUser: string;
    expectBodyContains?: string;
    expectBodyOmits?: string;
  }> = [
    {
      name: "keeps blocked distinct from unmatched",
      message: {
        from: "spam@evil.example",
        subject: "buy now",
        bodyText: "click",
        deterministicOutcome: "blocked",
      },
      expectOutcomeInUser: "deterministic_outcome: blocked",
    },
    {
      name: "keeps unmatched distinct from blocked",
      message: {
        from: "someone@example.com",
        subject: "hello",
        bodyText: "no terms",
        deterministicOutcome: "unmatched",
      },
      expectOutcomeInUser: "deterministic_outcome: unmatched",
    },
    {
      name: "truncates long bodies in the user message",
      message: {
        from: "a@example.com",
        subject: "long",
        bodyText: "Z".repeat(DEFAULT_PROMPT_BODY_CHARS + 10),
        deterministicOutcome: "priority",
      },
      expectOutcomeInUser: "deterministic_outcome: priority",
      expectBodyContains: "Z".repeat(40),
      expectBodyOmits: "Z".repeat(DEFAULT_PROMPT_BODY_CHARS + 1),
    },
  ];

  for (const row of cases) {
    test(row.name, () => {
      const exemplars = selectExemplarsByCategory([
        exemplar({ id: "e-p", ownerLabel: "priority", subject: "real outage" }),
        exemplar({ id: "e-a", ownerLabel: "archive", subject: "newsletter" }),
      ]);
      const prompt = assembleJudgePrompt({
        categoryIntent: intents,
        message: row.message,
        exemplars,
      });
      expect(prompt.system).toContain("priority: Needs owner today");
      expect(prompt.system).toContain("archive: Noise or done");
      expect(prompt.user).toContain(`from: ${row.message.from}`);
      expect(prompt.user).toContain(`subject: ${row.message.subject}`);
      expect(prompt.user).toContain(row.expectOutcomeInUser);
      expect(prompt.user).toContain("exemplar priority: real outage");
      expect(prompt.user).toContain("exemplar archive: newsletter");
      if (row.expectBodyContains) expect(prompt.user).toContain(row.expectBodyContains);
      if (row.expectBodyOmits) expect(prompt.user).not.toContain(row.expectBodyOmits);
      const categories: Category[] = ["priority", "review", "new", "archive"];
      for (const category of categories) {
        expect(prompt.system).toContain(`${category}:`);
      }
    });
  }
});
