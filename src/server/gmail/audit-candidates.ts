import {
  findClassificationMatch,
  type ClassificationOutcome,
  type ClassificationTerms,
} from "@/src/server/gmail/classify";
import {
  decryptMessageSnapshotPayload,
  type MessageSnapshotPlaintext,
} from "@/src/server/gmail/message-snapshot";
import type { AuditBatchMessage, EligibleAuditOutcome } from "@/src/server/gmail/audit-batch";

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

const AUDITABLE_OUTCOMES = new Set<EligibleAuditOutcome>(["priority", "review", "new"]);

function isAuditableOutcome(
  outcome: ClassificationOutcome | "failed" | null | undefined,
): outcome is EligibleAuditOutcome {
  return typeof outcome === "string" && AUDITABLE_OUTCOMES.has(outcome as EligibleAuditOutcome);
}

/**
 * Join snapshots with processing outcomes into judge inputs.
 * Only priority / review / new filings are judged.
 * Skips archive paths (blocked, unmatched), whitelist/starred (protected), and failed.
 * Already-judged ids (resume) are omitted.
 * When `terms` is provided, messages with no classifier keyword hit are also omitted.
 * Decrypt failures are reported separately so the run can mark partial_failure.
 */
export function buildAuditCandidates(input: Readonly<{
  snapshots: readonly SnapshotRowForAudit[];
  outcomes: readonly ProcessingOutcomeRow[];
  encryptionKey: string;
  alreadyJudgedIds?: ReadonlySet<string>;
  /** When set, only candidates with a keyword hit are returned. */
  terms?: ClassificationTerms;
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
    // No judge for archive filings, blocklist, whitelist/starred, or failures.
    if (!isAuditableOutcome(outcome)) continue;
    let plaintext: MessageSnapshotPlaintext;
    try {
      plaintext = decryptMessageSnapshotPayload(snapshot.encryptedPayload, input.encryptionKey);
    } catch {
      decryptFailures.push(snapshot.gmailMessageId);
      continue;
    }
    if (input.terms) {
      const match = findClassificationMatch(
        {
          from: plaintext.from,
          replyTo: plaintext.replyTo,
          subject: plaintext.subject,
          bodyText: plaintext.bodyText,
        },
        input.terms,
      );
      if (!match) continue;
    }
    candidates.push({
      gmailMessageId: snapshot.gmailMessageId,
      outcome,
      from: plaintext.from,
      replyTo: plaintext.replyTo,
      subject: plaintext.subject,
      bodyText: plaintext.bodyText,
    });
  }
  return { candidates, decryptFailures };
}
