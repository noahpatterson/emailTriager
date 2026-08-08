/** Shared demotion queue types — safe for client and server imports. */

import type { ClassificationOutcome } from "@/src/server/gmail/classify";

/** Demotions queued by audit are always archive (ADR-0010). */
export type PendingDemotionItem = Readonly<{
  id: number;
  gmailMessageId: string;
  gmailThreadId: string | null;
  gmailUrl: string | null;
  verdictId: number;
  recommendedCategory: "archive";
  rationale: string | null;
  agreesWithFiling: boolean | null;
  deterministicOutcome: ClassificationOutcome | "failed" | null;
  matchedTerm: string | null;
  classifierMatchSnippet: string | null;
  subject: string;
  from: string;
  bodyExcerpt: string;
  createdAt: string;
}>;

export type DemotionQueueResponse = Readonly<{
  pendingCount: number;
  items: readonly PendingDemotionItem[];
}>;

export type ConfirmDemotionResult = Readonly<{
  gmailMessageId: string;
  confirmed: boolean;
  alreadyConfirmed: boolean;
  cancelled?: boolean;
}>;
