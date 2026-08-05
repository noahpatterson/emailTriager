import type { ClassificationOutcome } from "@/src/server/gmail/classify";
import type { JudgeVerdictResult } from "@/src/server/gmail/judge";

export const DEFAULT_AUDIT_CONCURRENCY = 5;
export const DEFAULT_AUDIT_MAX_MESSAGES = 100;

export type AuditBatchMessage = Readonly<{
  gmailMessageId: string;
  outcome: ClassificationOutcome | "failed";
  from: string;
  subject: string;
  bodyText: string;
}>;

export type AuditBatchVerdict = JudgeVerdictResult & Readonly<{
  gmailMessageId: string;
}>;

/**
 * Judge non-protected messages with bounded concurrency.
 * Protected mail is skipped entirely — no verdict row (issue #17 / ADR-0010).
 */
export async function runAuditBatch(input: Readonly<{
  messages: readonly AuditBatchMessage[];
  concurrency?: number;
  judge: (message: AuditBatchMessage) => Promise<JudgeVerdictResult>;
}>): Promise<readonly AuditBatchVerdict[]> {
  const concurrency = Math.max(1, input.concurrency ?? DEFAULT_AUDIT_CONCURRENCY);
  const eligible = input.messages.filter((message) => message.outcome !== "protected");
  const verdicts: AuditBatchVerdict[] = new Array(eligible.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= eligible.length) return;
      const message = eligible[index]!;
      const verdict = await input.judge(message);
      verdicts[index] = { gmailMessageId: message.gmailMessageId, ...verdict };
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, eligible.length || 1) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return verdicts;
}
