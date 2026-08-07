/**
 * Judge Eval: score Holdout Owner Labels against judge trials.
 * See docs/ai-features-spec.md Slice 5.
 */
import {
  MATCHING_EVAL_CATEGORIES,
  type CategoryPrecisionRecall,
  type ConfusionMatrix,
} from "@/src/server/gmail/matching-eval";
import type { Category } from "@/src/server/gmail/corpus";

export type JudgeEvalTrial = Readonly<{
  ownerLabel: Category;
  recommendedCategory: Category | null;
  agreesWithFiling: boolean | null;
  malformed: boolean;
}>;

export type JudgeEvalMetrics = Readonly<{
  holdoutSize: number;
  scored: number;
  skipped: number;
  accuracy: number;
  disagreementRate: number;
  malformedOutputRate: number;
  confusionMatrix: ConfusionMatrix;
  perCategory: Readonly<Record<Category, CategoryPrecisionRecall>>;
}>;

function emptyMatrix(): Record<Category, Record<Category, number>> {
  const matrix = {} as Record<Category, Record<Category, number>>;
  for (const actual of MATCHING_EVAL_CATEGORIES) {
    matrix[actual] = { priority: 0, review: 0, new: 0, archive: 0 };
  }
  return matrix;
}

function precisionRecall(
  matrix: ConfusionMatrix,
  category: Category,
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
 * Aggregate judge trials against Owner Labels on Holdout.
 * Malformed output is skipped for accuracy / confusion / disagreement denominators
 * but counted in malformed-output rate over holdout size.
 */
export function runJudgeEval(trials: readonly JudgeEvalTrial[]): JudgeEvalMetrics {
  const holdoutSize = trials.length;
  const matrix = emptyMatrix();
  let scored = 0;
  let correct = 0;
  let skipped = 0;
  let malformed = 0;
  let disagreementNumer = 0;
  let disagreementDenom = 0;

  for (const trial of trials) {
    if (trial.malformed) {
      malformed += 1;
      skipped += 1;
      continue;
    }
    disagreementDenom += 1;
    if (trial.agreesWithFiling === false) disagreementNumer += 1;

    if (trial.recommendedCategory === null) {
      skipped += 1;
      continue;
    }
    matrix[trial.ownerLabel][trial.recommendedCategory] += 1;
    scored += 1;
    if (trial.recommendedCategory === trial.ownerLabel) correct += 1;
  }

  const perCategory = {} as Record<Category, CategoryPrecisionRecall>;
  for (const category of MATCHING_EVAL_CATEGORIES) {
    perCategory[category] = precisionRecall(matrix, category);
  }

  return {
    holdoutSize,
    scored,
    skipped,
    accuracy: scored === 0 ? 0 : correct / scored,
    disagreementRate: disagreementDenom === 0 ? 0 : disagreementNumer / disagreementDenom,
    malformedOutputRate: holdoutSize === 0 ? 0 : malformed / holdoutSize,
    confusionMatrix: matrix,
    perCategory,
  };
}
