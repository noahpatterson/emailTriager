import {
  AUDIT_JUDGE_SPAN,
  AUDIT_RUN_SPAN,
  type AuditTracer,
  type SpanAttributes,
  type SpanWriter,
} from "@/src/server/observability/tracer";

export type AuditRunSpanAttrs = Readonly<{
  runId: string;
  syncRunId: string;
}>;

/** Parent span for one Audit Run lifecycle (start → finish / failure). */
export function auditRunAttributes(attrs: AuditRunSpanAttrs): SpanAttributes {
  return {
    "audit.run_id": attrs.runId,
    "audit.sync_run_id": attrs.syncRunId,
  };
}

/** Child span attributes for one judge/model call — ids only; never message bodies. */
export function auditJudgeAttributes(input: Readonly<{
  runId: string;
  gmailMessageId: string;
}>): SpanAttributes {
  return {
    "audit.run_id": input.runId,
    "audit.message_id": input.gmailMessageId,
  };
}

/** Span around a single model call only (not lease renew / DB persist). */
export async function withJudgeSpan<T>(
  tracer: AuditTracer,
  input: Readonly<{ runId: string; gmailMessageId: string }>,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.withSpan(
    AUDIT_JUDGE_SPAN,
    auditJudgeAttributes(input),
    async () => fn(),
  );
}

export async function withAuditRunSpan<T>(
  tracer: AuditTracer,
  attrs: AuditRunSpanAttrs,
  fn: (span: SpanWriter) => Promise<T>,
): Promise<T> {
  return tracer.withSpan(AUDIT_RUN_SPAN, auditRunAttributes(attrs), fn);
}
