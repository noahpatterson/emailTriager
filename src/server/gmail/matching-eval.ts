/**
 * Matching Eval: full-replay scoring of a Candidate term list over Golden Set
 * Holdout frozen text. No Gmail, no model. See docs/ai-features-spec.md Slice 3.
 */
import {
  classifyWithReason,
  normalizeTerms,
  type ClassificationTerms,
} from "@/src/server/gmail/classify";
import {
  ADVERSARIAL_CORPUS,
  filingCategoryForOutcome,
  type Category,
  type CorpusFixture,
  type CorpusPartition,
} from "@/src/server/gmail/corpus";
import type { ParsedMessage } from "@/src/server/gmail/message";

export const MATCHING_EVAL_CATEGORIES = ["priority", "review", "new", "archive"] as const;
export type MatchingEvalCategory = (typeof MATCHING_EVAL_CATEGORIES)[number];

/**
 * Default cell costs (ownerLabel → predicted). Diagonal is 0.
 * Spec: priority loss dominates; blocked/unmatched treated as archive upstream.
 */
export const DEFAULT_MATCHING_EVAL_COSTS: Readonly<
  Record<MatchingEvalCategory, Readonly<Record<MatchingEvalCategory, number>>>
> = {
  priority: { priority: 0, review: 40, new: 40, archive: 100 },
  review: { priority: 20, review: 0, new: 20, archive: 60 },
  new: { priority: 20, review: 20, new: 0, archive: 50 },
  archive: { priority: 100, review: 30, new: 30, archive: 0 },
};

/**
 * CI floor: DEMO_CORPUS_TERMS currently scores ~19.3 weighted error on holdout.
 * Below this floor the adversarial corpus is not challenging enough.
 */
export const ADVERSARIAL_MATCHING_EVAL_FLOOR = 10;

export type GoldenSetRow = Readonly<{
  id?: string;
  from: string;
  subject: string;
  bodyText: string;
  ownerLabel: Category;
  partition: CorpusPartition;
}>;

export type ConfusionMatrix = Readonly<
  Record<MatchingEvalCategory, Readonly<Record<MatchingEvalCategory, number>>>
>;

export type CategoryPrecisionRecall = Readonly<{
  precision: number | null;
  recall: number | null;
  support: number;
}>;

export type MatchingEvalMetrics = Readonly<{
  holdoutSize: number;
  scored: number;
  skipped: number;
  confusionMatrix: ConfusionMatrix;
  perCategory: Readonly<Record<MatchingEvalCategory, CategoryPrecisionRecall>>;
  /** Sum of cell costs / holdout size. */
  weightedError: number;
  totalCost: number;
}>;

function emptyMatrix(): Record<MatchingEvalCategory, Record<MatchingEvalCategory, number>> {
  const matrix = {} as Record<MatchingEvalCategory, Record<MatchingEvalCategory, number>>;
  for (const actual of MATCHING_EVAL_CATEGORIES) {
    matrix[actual] = { priority: 0, review: 0, new: 0, archive: 0 };
  }
  return matrix;
}

export function matchingEvalCost(
  ownerLabel: MatchingEvalCategory,
  predicted: MatchingEvalCategory,
  costs: typeof DEFAULT_MATCHING_EVAL_COSTS = DEFAULT_MATCHING_EVAL_COSTS,
): number {
  return costs[ownerLabel][predicted];
}

export function corpusFixtureToGoldenRow(fixture: CorpusFixture): GoldenSetRow {
  return {
    id: fixture.id,
    from: fixture.from,
    subject: fixture.subject,
    bodyText: fixture.body,
    ownerLabel: fixture.ownerLabel,
    partition: fixture.partition,
  };
}

export function goldenRowsFromCorpus(
  corpus: readonly CorpusFixture[] = ADVERSARIAL_CORPUS,
): readonly GoldenSetRow[] {
  return corpus.map(corpusFixtureToGoldenRow);
}

function parsedFromGoldenRow(row: GoldenSetRow, index: number): ParsedMessage {
  return {
    id: row.id ?? `golden-${index}`,
    threadId: row.id ?? `golden-thr-${index}`,
    internalDate: null,
    labelIds: [],
    from: row.from,
    replyTo: "",
    subject: row.subject,
    bodyText: row.bodyText,
  };
}

function normalizeCandidateTerms(terms: ClassificationTerms): ClassificationTerms {
  return {
    priority: normalizeTerms(terms.priority),
    review: normalizeTerms(terms.review),
    new: normalizeTerms(terms.new),
  };
}

function precisionRecall(
  matrix: ConfusionMatrix,
  category: MatchingEvalCategory,
): CategoryPrecisionRecall {
  const support = MATCHING_EVAL_CATEGORIES.reduce(
    (sum, predicted) => sum + matrix[category][predicted],
    0,
  );
  const predictedAs = MATCHING_EVAL_CATEGORIES.reduce(
    (sum, actual) => sum + matrix[actual][category],
    0,
  );
  const truePositives = matrix[category][category];
  return {
    support,
    precision: predictedAs === 0 ? null : truePositives / predictedAs,
    recall: support === 0 ? null : truePositives / support,
  };
}

/**
 * Replay the deterministic classifier over Holdout rows and score against Owner Labels.
 */
export function runMatchingEval(
  rows: readonly GoldenSetRow[],
  candidateTerms: ClassificationTerms,
  options: Readonly<{
    costs?: typeof DEFAULT_MATCHING_EVAL_COSTS;
    /** When true (default), only score Holdout partition rows. */
    holdoutOnly?: boolean;
  }> = {},
): MatchingEvalMetrics {
  const costs = options.costs ?? DEFAULT_MATCHING_EVAL_COSTS;
  const holdoutOnly = options.holdoutOnly !== false;
  const holdout = holdoutOnly ? rows.filter((row) => row.partition === "holdout") : [...rows];
  const terms = normalizeCandidateTerms(candidateTerms);
  const matrix = emptyMatrix();
  let totalCost = 0;
  let scored = 0;
  let skipped = 0;

  holdout.forEach((row, index) => {
    const parsed = parsedFromGoldenRow(row, index);
    const { outcome } = classifyWithReason(parsed, terms, [], []);
    const predicted = filingCategoryForOutcome(outcome);
    if (predicted === null) {
      skipped += 1;
      return;
    }
    matrix[row.ownerLabel][predicted] += 1;
    totalCost += matchingEvalCost(row.ownerLabel, predicted, costs);
    scored += 1;
  });

  const perCategory = {} as Record<MatchingEvalCategory, CategoryPrecisionRecall>;
  for (const category of MATCHING_EVAL_CATEGORIES) {
    perCategory[category] = precisionRecall(matrix, category);
  }

  const holdoutSize = holdout.length;
  return {
    holdoutSize,
    scored,
    skipped,
    confusionMatrix: matrix,
    perCategory,
    totalCost,
    weightedError: holdoutSize === 0 ? 0 : totalCost / holdoutSize,
  };
}

/** Pure corpus path for CI — no database. */
export function runMatchingEvalAgainstCorpus(
  candidateTerms: ClassificationTerms,
): MatchingEvalMetrics {
  return runMatchingEval(goldenRowsFromCorpus(), candidateTerms);
}
