/**
 * Stratified Review Queue selection over Audit Run Verdicts.
 * All Disagreements + ~10% of agreements; never mutates Gmail (ADR-0004).
 */
import type { Category } from "@/src/server/gmail/corpus";
import type { ClassificationOutcome } from "@/src/server/gmail/classify";

export const DEFAULT_AGREEMENT_SAMPLE_RATE = 0.1;
/** Default sitting size — UI window; stratification itself is not truncated. */
export const DEFAULT_REVIEW_PAGE_SIZE = 20;

const OWNER_LABEL_CATEGORIES = ["priority", "review", "new", "archive"] as const satisfies readonly Category[];

export class ReviewClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewClientError";
  }
}

export function parseOwnerLabel(value: unknown): Category {
  if (
    typeof value !== "string"
    || !(OWNER_LABEL_CATEGORIES as readonly string[]).includes(value)
  ) {
    throw new ReviewClientError("ownerLabel must be priority, review, new, or archive.");
  }
  return value as Category;
}

export type ReviewQueueCandidate = Readonly<{
  verdictId: number;
  gmailMessageId: string;
  agreesWithFiling: boolean | null;
  deterministicOutcome: ClassificationOutcome | "failed";
  recommendedCategory: Category | null;
  rationale: string | null;
  malformed: boolean;
  subject: string;
  from: string;
  messageSnapshotExcerpt: string;
}>;

export type SelectReviewQueueOptions = Readonly<{
  /** Inclusive sample rate for agreements (default 0.1). */
  agreementSampleRate?: number;
  /** Messages already carrying an Owner Label — excluded from pending. */
  alreadyLabeledIds?: ReadonlySet<string>;
  /** Injected RNG in [0, 1) for deterministic tests. */
  random?: () => number;
}>;

/**
 * Stratified pending Review Queue: every Disagreement, then ~10% of agreements.
 * Does not truncate — sitting size is applied by takeReviewSitting / the UI.
 */
export function selectReviewQueueItems(
  candidates: readonly ReviewQueueCandidate[],
  options: SelectReviewQueueOptions = {},
): readonly ReviewQueueCandidate[] {
  const agreementSampleRate = options.agreementSampleRate ?? DEFAULT_AGREEMENT_SAMPLE_RATE;
  const alreadyLabeled = options.alreadyLabeledIds ?? new Set<string>();
  const random = options.random ?? Math.random;

  const pending = candidates.filter(
    (item) =>
      !item.malformed
      && !alreadyLabeled.has(item.gmailMessageId)
      && item.agreesWithFiling !== null,
  );

  const disagreements = pending.filter((item) => item.agreesWithFiling === false);
  const agreements = pending.filter(
    (item) => item.agreesWithFiling === true && random() < agreementSampleRate,
  );

  return [...disagreements, ...agreements];
}

/** One sitting window over an already-stratified pending queue. */
export function takeReviewSitting(
  items: readonly ReviewQueueCandidate[],
  pageSize: number = DEFAULT_REVIEW_PAGE_SIZE,
  offset: number = 0,
): readonly ReviewQueueCandidate[] {
  const start = Math.max(0, offset);
  const size = Math.max(0, pageSize);
  return items.slice(start, start + size);
}
