/**
 * Stratified Review Queue selection over Audit Run Verdicts.
 * All Disagreements + ~10% of agreements (fixed-size sample, min 1).
 * Owner Label submit re-files Gmail (ADR-0004).
 */
import type { Category } from "@/src/server/gmail/corpus";
import type { ClassificationOutcome } from "@/src/server/gmail/classify";

export const DEFAULT_AGREEMENT_SAMPLE_RATE = 0.1;
/** Default sitting size — UI window; stratification itself is not truncated. */
export const DEFAULT_REVIEW_PAGE_SIZE = 20;

export type ReviewQueueMode = "stratified" | "all";

const OWNER_LABEL_CATEGORIES = ["priority", "review", "new", "archive"] as const satisfies readonly Category[];

export function parseReviewQueueMode(value: unknown): ReviewQueueMode {
  return value === "all" ? "all" : "stratified";
}
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
  gmailThreadId: string | null;
  /** Opens the thread in Gmail web when a thread id is known. */
  gmailUrl: string | null;
  agreesWithFiling: boolean | null;
  deterministicOutcome: ClassificationOutcome | "failed";
  /** Classifier reason string from sync (may predate match excerpts). */
  outcomeReason: string | null;
  /** Term that produced the deterministic filing, when a keyword matched. */
  matchedTerm: string | null;
  /**
   * Surrounding normalized corpus window sent to the judge as classifier_match.
   * Null when blocked/unmatched/protected or no term hit.
   */
  classifierMatchSnippet: string | null;
  recommendedCategory: Category | null;
  rationale: string | null;
  malformed: boolean;
  subject: string;
  from: string;
  messageSnapshotExcerpt: string;
}>;

export type SelectReviewQueueOptions = Readonly<{
  /** Target sample rate for agreements (default 0.1). Ignored when mode is `all`. */
  agreementSampleRate?: number;
  /** `stratified` (default): all disagreements + ~rate agreements (min 1). `all`: every pending verdict. */
  mode?: ReviewQueueMode;
  /** Messages already carrying an Owner Label — excluded from pending. */
  alreadyLabeledIds?: ReadonlySet<string>;
  /** Injected RNG in [0, 1) for deterministic tests. */
  random?: () => number;
}>;

/**
 * Fixed-size ~rate sample of agreements (not independent Bernoulli).
 * Always keeps at least one when any unlabeled agreements exist — small audits
 * otherwise empty the queue ~60% of the time at the default 10% rate.
 */
export function agreementSampleSize(
  agreementCount: number,
  rate: number = DEFAULT_AGREEMENT_SAMPLE_RATE,
): number {
  if (agreementCount <= 0) return 0;
  const rounded = Math.round(agreementCount * rate);
  return Math.min(agreementCount, Math.max(1, rounded));
}

/** Partial Fisher–Yates: first `count` slots are a uniform random sample. */
function sampleWithoutReplacement<T>(
  items: readonly T[],
  count: number,
  random: () => number,
): T[] {
  const size = Math.min(count, items.length);
  if (size <= 0) return [];
  const copy = [...items];
  for (let i = 0; i < size; i += 1) {
    const j = i + Math.floor(random() * (copy.length - i));
    const swap = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = swap;
  }
  return copy.slice(0, size);
}

/**
 * Pending Review Queue over verdicts.
 * - stratified (default): every Disagreement, then ~10% of agreements (min 1)
 * - all: every non-malformed, unlabeled verdict with a known agreement flag
 * Does not truncate — sitting size is applied by takeReviewSitting / the UI.
 */
export function selectReviewQueueItems(
  candidates: readonly ReviewQueueCandidate[],
  options: SelectReviewQueueOptions = {},
): readonly ReviewQueueCandidate[] {
  const mode = options.mode ?? "stratified";
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
  const agreements = pending.filter((item) => item.agreesWithFiling === true);

  if (mode === "all") {
    return [...disagreements, ...agreements];
  }

  const sampledAgreements = sampleWithoutReplacement(
    agreements,
    agreementSampleSize(agreements.length, agreementSampleRate),
    random,
  );

  return [...disagreements, ...sampledAgreements];
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
