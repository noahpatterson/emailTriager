import type { ClassificationOutcome } from "@/src/server/gmail/classify";
import { filingCategoryForOutcome, type Category } from "@/src/server/gmail/corpus";

export type AuditMutationDecision = "skip" | "promote" | "pending_demotion";

export type DecideAuditMutationInput = Readonly<{
  deterministicOutcome: ClassificationOutcome | "failed";
  recommendedCategory: Category;
  autoApplyPromotions: boolean;
  malformed: boolean;
  agreesWithFiling: boolean;
}>;

/** Category rank: higher number = higher priority (archive lowest). */
const CATEGORY_RANK: Readonly<Record<Category, number>> = {
  archive: 0,
  new: 1,
  review: 2,
  priority: 3,
};

export function categoryRank(category: Category): number {
  return CATEGORY_RANK[category];
}

export function isPromotion(current: Category, recommended: Category): boolean {
  return categoryRank(recommended) > categoryRank(current);
}

export function isDemotionToArchive(current: Category, recommended: Category): boolean {
  return recommended === "archive" && current !== "archive";
}

/**
 * Decide whether a disagreeing verdict should promote, queue a demotion, or skip.
 * Protected/failed filings never reach here via audit candidates, but still skip defensively.
 */
export function decideAuditMutation(input: DecideAuditMutationInput): AuditMutationDecision {
  if (input.malformed || input.agreesWithFiling) return "skip";

  const current = filingCategoryForOutcome(input.deterministicOutcome);
  if (current === null) return "skip";

  if (isDemotionToArchive(current, input.recommendedCategory)) {
    return "pending_demotion";
  }

  if (isPromotion(current, input.recommendedCategory)) {
    return input.autoApplyPromotions ? "promote" : "skip";
  }

  return "skip";
}
