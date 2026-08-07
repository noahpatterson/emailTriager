import type { ClassificationOutcome } from "@/src/server/gmail/classify";
import {
  decryptMessageSnapshotPayload,
  type MessageSnapshotPlaintext,
} from "@/src/server/gmail/message-snapshot";
import type { AuditBatchMessage } from "@/src/server/gmail/audit-batch";

/** Same shape as MessageSnapshotListRow — kept here to avoid server-only coupling in pure helpers. */
export type SnapshotRowForAudit = Readonly<{
  gmailMessageId: string;
  encryptedPayload: string;
  keyVersion: number;
}>;

export type ProcessingOutcomeRow = Readonly<{
  gmailMessageId: string;
  outcome: ClassificationOutcome | "failed" | null;
}>;

export type AuditCandidateBuildResult = Readonly<{
  candidates: readonly AuditBatchMessage[];
  /** Snapshot ids that could not be decrypted (must not look like a clean complete run). */
  decryptFailures: readonly string[];
}>;

/**
 * Join snapshots with processing outcomes into judge inputs.
 * Protected outcomes are omitted (no verdict). Missing snapshots / failed rows skipped.
 * Already-judged ids (resume) are omitted.
 * Decrypt failures are reported separately so the run can mark partial_failure.
 */
export function buildAuditCandidates(input: Readonly<{
  snapshots: readonly SnapshotRowForAudit[];
  outcomes: readonly ProcessingOutcomeRow[];
  encryptionKey: string;
  alreadyJudgedIds?: ReadonlySet<string>;
}>): AuditCandidateBuildResult {
  const outcomeById = new Map(
    input.outcomes.map((row) => [row.gmailMessageId, row.outcome] as const),
  );
  const judged = input.alreadyJudgedIds ?? new Set<string>();
  const candidates: AuditBatchMessage[] = [];
  const decryptFailures: string[] = [];

  for (const snapshot of input.snapshots) {
    if (judged.has(snapshot.gmailMessageId)) continue;
    const outcome = outcomeById.get(snapshot.gmailMessageId);
    if (!outcome || outcome === "failed" || outcome === "protected") continue;
    let plaintext: MessageSnapshotPlaintext;
    try {
      plaintext = decryptMessageSnapshotPayload(snapshot.encryptedPayload, input.encryptionKey);
    } catch {
      decryptFailures.push(snapshot.gmailMessageId);
      continue;
    }
    candidates.push({
      gmailMessageId: snapshot.gmailMessageId,
      outcome,
      from: plaintext.from,
      subject: plaintext.subject,
      bodyText: plaintext.bodyText,
    });
  }
  return { candidates, decryptFailures };
}
