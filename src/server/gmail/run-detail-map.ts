import type { RunResultRow } from "@/app/run-results";
import type { ClassificationOutcome } from "./classify";
import type { GmailLabel } from "./labels";
import { destinationFor } from "./sync";

type LabelConfiguration = Readonly<{
  sourceLabelId: string;
  priorityLabelId: string;
  reviewLabelId: string;
  newLabelId: string;
  archiveLabelId: string;
}>;

type ProcessingRow = Readonly<{
  gmailMessageId: string;
  gmailThreadId: string | null;
  subject: string | null;
  senderAddress: string | null;
  outcome: string | null;
  outcomeReason?: string | null;
}>;

const OUTCOMES = new Set<string>(["priority", "review", "new", "unmatched", "protected", "failed", "blocked"]);

/** Null when the run is missing or belongs to another owner. */
export function ownedRunOrNull<T extends { ownerAuthUserId: string }>(
  run: T | undefined,
  ownerId: string,
): T | null {
  if (!run || run.ownerAuthUserId !== ownerId) return null;
  return run;
}

export function buildRunResultRows(
  rows: readonly ProcessingRow[],
  labels: LabelConfiguration | null,
  catalog?: readonly GmailLabel[],
): readonly RunResultRow[] {
  const nameFor = (id: string | null): string | null => {
    if (!id) return null;
    if (!catalog?.length) return id;
    return catalog.find((label) => label.id === id)?.name ?? id;
  };

  return rows.map((row) => {
    const outcome = row.outcome && OUTCOMES.has(row.outcome) ? row.outcome : "failed";
    const destination = labels && outcome !== "failed"
      ? destinationFor(outcome as ClassificationOutcome, labels)
      : null;
    return {
      gmailMessageId: row.gmailMessageId,
      gmailThreadId: row.gmailThreadId,
      subject: row.subject,
      senderAddress: row.senderAddress,
      outcome,
      reason: row.outcomeReason?.trim() || null,
      proposedLabelId: nameFor(destination),
    };
  });
}
