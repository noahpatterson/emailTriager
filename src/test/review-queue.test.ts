import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AGREEMENT_SAMPLE_RATE,
  DEFAULT_REVIEW_PAGE_SIZE,
  selectReviewQueueItems,
  type ReviewQueueCandidate,
} from "../server/gmail/review-queue";

function candidate(
  overrides: Partial<ReviewQueueCandidate> &
    Pick<ReviewQueueCandidate, "gmailMessageId" | "agreesWithFiling">,
): ReviewQueueCandidate {
  return {
    verdictId: 1,
    deterministicOutcome: "new",
    recommendedCategory: "new",
    rationale: "ok",
    malformed: false,
    subject: "Subject",
    from: "a@example.com",
    bodyExcerpt: "body",
    ...overrides,
  };
}

describe("review queue stratification", () => {
  test("includes every disagreement", () => {
    const items = [
      candidate({ gmailMessageId: "d1", agreesWithFiling: false }),
      candidate({ gmailMessageId: "d2", agreesWithFiling: false }),
      candidate({ gmailMessageId: "a1", agreesWithFiling: true }),
    ];
    const queue = selectReviewQueueItems(items, {
      random: () => 0.99,
      agreementSampleRate: 0.1,
    });
    expect(queue.map((item) => item.gmailMessageId)).toEqual(["d1", "d2"]);
  });

  test("samples approximately ten percent of agreements when random is below rate", () => {
    const agreements = Array.from({ length: 10 }, (_, index) =>
      candidate({
        gmailMessageId: `a${index}`,
        agreesWithFiling: true,
      }),
    );
    let calls = 0;
    const queue = selectReviewQueueItems(agreements, {
      agreementSampleRate: DEFAULT_AGREEMENT_SAMPLE_RATE,
      // First call included, rest excluded.
      random: () => (calls++ === 0 ? 0.05 : 0.5),
    });
    expect(queue).toHaveLength(1);
    expect(queue[0]?.gmailMessageId).toBe("a0");
  });

  test("excludes malformed verdicts from the queue", () => {
    const queue = selectReviewQueueItems(
      [
        candidate({
          gmailMessageId: "bad",
          agreesWithFiling: false,
          malformed: true,
        }),
        candidate({ gmailMessageId: "good", agreesWithFiling: false }),
      ],
      { random: () => 0 },
    );
    expect(queue.map((item) => item.gmailMessageId)).toEqual(["good"]);
  });

  test("excludes already-labeled messages", () => {
    const queue = selectReviewQueueItems(
      [
        candidate({ gmailMessageId: "done", agreesWithFiling: false }),
        candidate({ gmailMessageId: "todo", agreesWithFiling: false }),
      ],
      {
        random: () => 0,
        alreadyLabeledIds: new Set(["done"]),
      },
    );
    expect(queue.map((item) => item.gmailMessageId)).toEqual(["todo"]);
  });

  test("defaults page size to 20 and truncates after stratification", () => {
    const disagreements = Array.from({ length: 25 }, (_, index) =>
      candidate({
        gmailMessageId: `d${index}`,
        agreesWithFiling: false,
      }),
    );
    const queue = selectReviewQueueItems(disagreements, { random: () => 0 });
    expect(DEFAULT_REVIEW_PAGE_SIZE).toBe(20);
    expect(queue).toHaveLength(20);
    expect(queue[0]?.gmailMessageId).toBe("d0");
    expect(queue[19]?.gmailMessageId).toBe("d19");
  });

  test("disagreements sort before sampled agreements", () => {
    const queue = selectReviewQueueItems(
      [
        candidate({ gmailMessageId: "a1", agreesWithFiling: true }),
        candidate({ gmailMessageId: "d1", agreesWithFiling: false }),
        candidate({ gmailMessageId: "a2", agreesWithFiling: true }),
      ],
      { random: () => 0 },
    );
    expect(queue.map((item) => item.gmailMessageId)).toEqual(["d1", "a1", "a2"]);
  });

  test("null agreesWithFiling is treated as not an agreement sample candidate", () => {
    const queue = selectReviewQueueItems(
      [
        candidate({
          gmailMessageId: "nullish",
          agreesWithFiling: null,
        }),
      ],
      { random: () => 0 },
    );
    expect(queue).toEqual([]);
  });
});
