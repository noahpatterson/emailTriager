import type { ClassificationOutcome } from "@/src/server/gmail/classify";
import type { JudgeVerdictResult } from "@/src/server/gmail/judge";

export const DEFAULT_AUDIT_CONCURRENCY = 5;
export const DEFAULT_AUDIT_MAX_MESSAGES = 100;

/** Eligible for judging — protected is excluded upstream in buildAuditCandidates (ADR-0010). */
export type EligibleAuditOutcome = Exclude<ClassificationOutcome, "protected">;

export type AuditBatchMessage = Readonly<{
  gmailMessageId: string;
  outcome: EligibleAuditOutcome;
  from: string;
  subject: string;
  bodyText: string;
}>;

export type AuditBatchVerdict = JudgeVerdictResult & Readonly<{
  gmailMessageId: string;
}>;

/**
 * Judge eligible messages with bounded concurrency.
 * Caller must omit protected mail (buildAuditCandidates) — no verdict row (issue #17 / ADR-0010).
 * On judge failure: stop claiming new work, drain active workers, then rethrow.
 */
export async function runAuditBatch(input: Readonly<{
  messages: readonly AuditBatchMessage[];
  concurrency?: number;
  judge: (message: AuditBatchMessage) => Promise<JudgeVerdictResult>;
}>): Promise<readonly AuditBatchVerdict[]> {
  const concurrency = Math.max(1, input.concurrency ?? DEFAULT_AUDIT_CONCURRENCY);
  const messages = input.messages;
  const verdicts: AuditBatchVerdict[] = new Array(messages.length);
  let nextIndex = 0;
  let stopped = false;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= messages.length) return;
      const message = messages[index]!;
      try {
        const verdict = await input.judge(message);
        verdicts[index] = { gmailMessageId: message.gmailMessageId, ...verdict };
      } catch (caught) {
        stopped = true;
        firstError ??= caught;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(messages.length, 1)) },
    () => worker(),
  );
  await Promise.all(workers);
  if (firstError !== undefined) throw firstError;
  return verdicts.filter((row): row is AuditBatchVerdict => row !== undefined);
}
