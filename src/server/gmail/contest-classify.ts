import type { ParsedMessage } from "./message";

export const CONTEST_CATEGORIES = [
  "winner", "new_contest", "entry_confirmation", "notification_update", "irrelevant",
] as const;
export type ContestCategory = typeof CONTEST_CATEGORIES[number];
export type ContestMessage = Readonly<Pick<ParsedMessage, "from" | "replyTo" | "subject" | "bodyText" | "labelIds">>;
export type ContestClassification = Readonly<{
  category: ContestCategory;
  categoryProbabilities: Readonly<Record<ContestCategory, number>>;
  confidence: number;
  explicitWinProbability: number;
  claimActionProbability: number;
  model: string;
  promptVersion: string;
  usage: Readonly<{ inputTokens: number; outputTokens: number }>;
}>;
export type ContestClassifier = (message: ContestMessage) => Promise<ContestClassification>;

export const DEFAULT_WINNER_THRESHOLD = 0.9;

/** Eligibility policy only; callers decide how to present or deliver a winner. */
export function isHighConfidenceContestWinner<T extends Pick<ContestClassification, "category" | "explicitWinProbability">>(
  result: T,
  threshold: number = DEFAULT_WINNER_THRESHOLD,
): boolean {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("Winner threshold must be between 0 and 1");
  }
  return result.category === "winner" && result.explicitWinProbability >= threshold;
}

/** Stable ties retain the caller's order; the input collection is not mutated. */
export function sortContestResultsByWinProbability<T extends ContestClassification>(results: readonly T[]): readonly T[] {
  return [...results].sort((left, right) => right.explicitWinProbability - left.explicitWinProbability);
}
