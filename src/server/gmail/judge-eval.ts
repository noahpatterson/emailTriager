/**
 * Judge Eval: score Holdout Owner Labels against judge trials.
 * See docs/ai-features-spec.md Slice 5.
 */
import {
  emptyEvalMatrix,
  evalPrecisionRecall,
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

/**
 * Aggregate judge trials against Owner Labels on Holdout.
 * Malformed output is skipped for accuracy / confusion / disagreement denominators
 * but counted in malformed-output rate over holdout size.
 */
export function runJudgeEval(trials: readonly JudgeEvalTrial[]): JudgeEvalMetrics {
  const holdoutSize = trials.length;
  const matrix = emptyEvalMatrix();
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
    perCategory[category] = evalPrecisionRecall(matrix, category);
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
