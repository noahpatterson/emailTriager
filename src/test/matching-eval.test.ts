import { describe, expect, test } from "bun:test";
import { DEMO_CORPUS_TERMS } from "../server/gmail/corpus";
import {
  ADVERSARIAL_MATCHING_EVAL_FLOOR,
  DEFAULT_MATCHING_EVAL_COSTS,
  goldenRowsFromCorpus,
  matchingEvalCost,
  runMatchingEval,
  runMatchingEvalAgainstCorpus,
  type GoldenSetRow,
} from "../server/gmail/matching-eval";

function row(
  overrides: Partial<GoldenSetRow> & Pick<GoldenSetRow, "ownerLabel">,
): GoldenSetRow {
  return {
    id: "g1",
    from: "sender@example.com",
    subject: "hello",
    bodyText: "body",
    partition: "holdout",
    ...overrides,
  };
}

describe("matching eval cost weights", () => {
  const cases: ReadonlyArray<{
    actual: keyof typeof DEFAULT_MATCHING_EVAL_COSTS;
    predicted: keyof typeof DEFAULT_MATCHING_EVAL_COSTS;
    cost: number;
  }> = [
    { actual: "priority", predicted: "priority", cost: 0 },
    { actual: "priority", predicted: "archive", cost: 100 },
    { actual: "priority", predicted: "review", cost: 40 },
    { actual: "priority", predicted: "new", cost: 40 },
    { actual: "review", predicted: "archive", cost: 60 },
    { actual: "new", predicted: "archive", cost: 50 },
    { actual: "archive", predicted: "priority", cost: 100 },
    { actual: "archive", predicted: "review", cost: 30 },
    { actual: "archive", predicted: "new", cost: 30 },
    { actual: "review", predicted: "priority", cost: 20 },
    { actual: "review", predicted: "new", cost: 20 },
    { actual: "new", predicted: "priority", cost: 20 },
    { actual: "new", predicted: "review", cost: 20 },
  ];

  for (const { actual, predicted, cost } of cases) {
    test(`${actual}→${predicted} costs ${cost}`, () => {
      expect(matchingEvalCost(actual, predicted)).toBe(cost);
    });
  }
});

describe("matching eval replay", () => {
  const terms = { priority: ["urgent"], review: ["please review"], new: ["new inquiry"] };

  const vectors: ReadonlyArray<{
    name: string;
    rows: readonly GoldenSetRow[];
    terms?: typeof terms;
    expect: Readonly<{
      holdoutSize: number;
      weightedError: number;
      matrixCell?: Readonly<{ actual: GoldenSetRow["ownerLabel"]; predicted: GoldenSetRow["ownerLabel"]; count: number }>;
    }>;
  }> = [
    {
      name: "scores holdout only; exemplar ignored",
      rows: [
        row({ id: "h1", ownerLabel: "priority", subject: "urgent outage", bodyText: "need help" }),
        row({ id: "h2", ownerLabel: "archive", subject: "URGENT: 50% off", bodyText: "sale" }),
        row({
          id: "e1",
          ownerLabel: "priority",
          subject: "urgent outage",
          bodyText: "exemplar should be ignored",
          partition: "exemplar",
        }),
      ],
      expect: {
        holdoutSize: 2,
        weightedError: 50,
        matrixCell: { actual: "archive", predicted: "priority", count: 1 },
      },
    },
    {
      name: "unmatched treated as archive",
      rows: [
        row({
          ownerLabel: "priority",
          subject: "please help with billing",
          bodyText: "no terms here",
        }),
      ],
      expect: {
        holdoutSize: 1,
        weightedError: 100,
        matrixCell: { actual: "priority", predicted: "archive", count: 1 },
      },
    },
    {
      name: "correct priority match is zero cost",
      rows: [row({ ownerLabel: "priority", subject: "urgent outage", bodyText: "act now" })],
      expect: { holdoutSize: 1, weightedError: 0 },
    },
  ];

  for (const vector of vectors) {
    test(vector.name, () => {
      const metrics = runMatchingEval(vector.rows, vector.terms ?? terms);
      expect(metrics.holdoutSize).toBe(vector.expect.holdoutSize);
      expect(metrics.weightedError).toBe(vector.expect.weightedError);
      if (vector.expect.matrixCell) {
        const { actual, predicted, count } = vector.expect.matrixCell;
        expect(metrics.confusionMatrix[actual][predicted]).toBe(count);
      }
    });
  }

  test("scalar is sum of cell costs divided by holdout size", () => {
    const rows = goldenRowsFromCorpus().filter((r) => r.partition === "holdout").slice(0, 4);
    const metrics = runMatchingEval(rows, DEMO_CORPUS_TERMS, { holdoutOnly: false });
    let recomputed = 0;
    for (const actual of ["priority", "review", "new", "archive"] as const) {
      for (const predicted of ["priority", "review", "new", "archive"] as const) {
        recomputed += metrics.confusionMatrix[actual][predicted]
          * DEFAULT_MATCHING_EVAL_COSTS[actual][predicted];
      }
    }
    expect(metrics.totalCost).toBe(recomputed);
    expect(metrics.weightedError).toBe(recomputed / metrics.holdoutSize);
  });
});

describe("adversarial corpus matching eval CI gate", () => {
  test("DEMO_CORPUS_TERMS weighted error stays above the adversarial floor", () => {
    const metrics = runMatchingEvalAgainstCorpus(DEMO_CORPUS_TERMS);
    expect(metrics.holdoutSize).toBe(75);
    expect(metrics.scored).toBe(75);
    // Near-zero error means the corpus is not adversarial enough (ADR-0008 / Slice 3).
    expect(metrics.weightedError).toBeGreaterThanOrEqual(ADVERSARIAL_MATCHING_EVAL_FLOOR);
    // Lock the known score for DEMO_CORPUS_TERMS so silent corpus softening is visible.
    expect(metrics.weightedError).toBeCloseTo(19.3333333333, 5);
  });
});
