import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AGREEMENT_SAMPLE_RATE,
  DEFAULT_REVIEW_PAGE_SIZE,
  selectReviewQueueItems,
  takeReviewSitting,
  type ReviewQueueCandidate,
} from "../server/gmail/review-queue";

function candidate(
  overrides: Partial<ReviewQueueCandidate> &
    Pick<ReviewQueueCandidate, "gmailMessageId" | "agreesWithFiling">,
): ReviewQueueCandidate {
  return {
    verdictId: 1,
    gmailThreadId: "thread-1",
    gmailUrl: "https://mail.google.com/mail/u/0/#all/thread-1",
    deterministicOutcome: "new",
    outcomeReason: null,
    matchedTerm: null,
    classifierMatchSnippet: null,
    recommendedCategory: "new",
    rationale: "ok",
    malformed: false,
    subject: "Subject",
    from: "a@example.com",
    messageSnapshotExcerpt: "body",
    ...overrides,
  };
}

describe("review queue stratification", () => {
  test("includes every disagreement plus a fixed agreement sample", () => {
    const items = [
      candidate({ gmailMessageId: "d1", agreesWithFiling: false }),
      candidate({ gmailMessageId: "d2", agreesWithFiling: false }),
      candidate({ gmailMessageId: "a1", agreesWithFiling: true }),
    ];
    const queue = selectReviewQueueItems(items, {
      // Always picks the sole agreement when k=1 (round(1*0.1) floors to 0 → min 1).
      random: () => 0,
      agreementSampleRate: 0.1,
    });
    expect(queue.map((item) => item.gmailMessageId)).toEqual(["d1", "d2", "a1"]);
  });

  test("mode all includes every pending agreement and disagreement", () => {
    const items = [
      candidate({ gmailMessageId: "d1", agreesWithFiling: false }),
      candidate({ gmailMessageId: "a1", agreesWithFiling: true }),
      candidate({ gmailMessageId: "a2", agreesWithFiling: true }),
    ];
    const queue = selectReviewQueueItems(items, {
      mode: "all",
      random: () => 0.99,
    });
    expect(queue.map((item) => item.gmailMessageId)).toEqual(["d1", "a1", "a2"]);
  });

  test("samples about ten percent of agreements with a stable count", () => {
    const agreements = Array.from({ length: 10 }, (_, index) =>
      candidate({
        gmailMessageId: `a${index}`,
        agreesWithFiling: true,
      }),
    );
    const queue = selectReviewQueueItems(agreements, {
      agreementSampleRate: DEFAULT_AGREEMENT_SAMPLE_RATE,
      random: () => 0,
    });
    expect(queue).toHaveLength(1);
    expect(queue[0]?.gmailMessageId).toBe("a0");
  });

  test("small agreement-only audits still queue at least one message", () => {
    const agreements = Array.from({ length: 5 }, (_, index) =>
      candidate({
        gmailMessageId: `a${index}`,
        agreesWithFiling: true,
      }),
    );
    // Independent Bernoulli at 10% empties ~59% of the time; fixed-size sample must not.
    const queue = selectReviewQueueItems(agreements, {
      agreementSampleRate: DEFAULT_AGREEMENT_SAMPLE_RATE,
      random: () => 0.99,
    });
    expect(queue).toHaveLength(1);
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

  test("keeps all disagreements in the stratified pool without truncating", () => {
    const disagreements = Array.from({ length: 25 }, (_, index) =>
      candidate({
        gmailMessageId: `d${index}`,
        agreesWithFiling: false,
      }),
    );
    const queue = selectReviewQueueItems(disagreements, { random: () => 0 });
    expect(queue).toHaveLength(25);
    expect(queue[24]?.gmailMessageId).toBe("d24");
  });

  test("sitting window defaults to 20 over the stratified pool", () => {
    const disagreements = Array.from({ length: 25 }, (_, index) =>
      candidate({
        gmailMessageId: `d${index}`,
        agreesWithFiling: false,
      }),
    );
    const stratified = selectReviewQueueItems(disagreements, { random: () => 0 });
    const sitting = takeReviewSitting(stratified);
    expect(DEFAULT_REVIEW_PAGE_SIZE).toBe(20);
    expect(sitting).toHaveLength(20);
    expect(sitting[0]?.gmailMessageId).toBe("d0");
    expect(sitting[19]?.gmailMessageId).toBe("d19");
    const nextSitting = takeReviewSitting(stratified, DEFAULT_REVIEW_PAGE_SIZE, 20);
    expect(nextSitting.map((item) => item.gmailMessageId)).toEqual([
      "d20", "d21", "d22", "d23", "d24",
    ]);
  });

  test("disagreements sort before sampled agreements", () => {
    const queue = selectReviewQueueItems(
      [
        candidate({ gmailMessageId: "a1", agreesWithFiling: true }),
        candidate({ gmailMessageId: "d1", agreesWithFiling: false }),
        candidate({ gmailMessageId: "a2", agreesWithFiling: true }),
      ],
      { random: () => 0, agreementSampleRate: 1 },
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
