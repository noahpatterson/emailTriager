import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { LanguageModel } from "ai";
import {
  auditRun,
  goldenSetMessage,
  messageProcessing,
  promptVersion,
  syncLease,
  syncRun,
  triageConfig,
  verdict,
} from "@/db/schema";
import { getServerConfig } from "@/src/config/server";
import {
  asCategoryIntent,
  hasCompleteCategoryIntent,
} from "@/src/server/config/triage-validate";
import { database, type Database } from "@/src/server/db";
import {
  DEFAULT_AUDIT_CONCURRENCY,
  DEFAULT_AUDIT_MAX_MESSAGES,
  runAuditBatch,
  type AuditBatchMessage,
} from "@/src/server/gmail/audit-batch";
import { buildAuditCandidates } from "@/src/server/gmail/audit-candidates";
import { JudgeTransportError, judgeMessage } from "@/src/server/gmail/judge";
import {
  assembleJudgePrompt,
  judgeSystemPromptFor,
  selectExemplarsByCategory,
  type ExemplarSnippet,
} from "@/src/server/gmail/judge-prompt";
import { DatabaseMessageSnapshotStore } from "@/src/server/gmail/message-snapshot-store";
import {
  createJudgeModel,
  getModelConfig,
  type ModelRuntimeConfig,
} from "@/src/server/gmail/model-config";
import { promptVersionIdFor } from "@/src/server/gmail/prompt-version";
import {
  withAuditRunSpan,
  withJudgeSpan,
} from "@/src/server/observability/audit-spans";
import {
  createAuditTracer,
  type AuditTracer,
} from "@/src/server/observability/tracer";
import type { ClassificationOutcome } from "@/src/server/gmail/classify";
import type { Category } from "@/src/server/gmail/corpus";

const AUDIT_LEASE_SECONDS = 300;
const LEASE_RENEW_INTERVAL_MS = 60_000;

/** Stable codes persisted in errorSummary — never raw driver/provider text. */
export const AUDIT_ERROR_CODES = [
  "lease_lost",
  "judge_transport",
  "decrypt_failed",
  "audit_failed",
] as const;

export type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[number];

export const AUDIT_ERROR_CODE_SET: ReadonlySet<string> = new Set(AUDIT_ERROR_CODES);

export type AuditRunStatus =
  | "running"
  | "bounded_incomplete"
  | "completed"
  | "partial_failure"
  | "failed";

export class AuditLeaseLostError extends Error {
  readonly code = "lease_lost" as const;
  constructor() {
    super("Audit lease lost");
    this.name = "AuditLeaseLostError";
  }
}

export class AuditAlreadyRunningError extends Error {
  constructor() {
    super("Synchronization already running");
    this.name = "AuditAlreadyRunningError";
  }
}

/** Owner-facing validation failures — map to HTTP 400 without message substring matching. */
export class AuditClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditClientError";
  }
}

export type AuditStartOptions = Readonly<{
  syncRunId: string;
  /** Resume an existing incomplete audit run. */
  auditRunId?: string;
  concurrency?: number;
  maxMessages?: number;
}>;

export type AuditStartResult = Readonly<{
  id: string;
  syncRunId: string;
  status: "completed" | "bounded_incomplete" | "partial_failure" | "failed";
  processedCount: number;
  totalEligible: number;
  nextCursor: string | null;
  malformedCount: number;
  errorCode: AuditErrorCode | null;
}>;

export type AuditStatusView = Readonly<{
  id: string;
  syncRunId: string;
  status: AuditRunStatus;
  processedCount: number;
  totalEligible: number;
  nextCursor: string | null;
  modelProvider: string;
  modelName: string;
  promptVersionId: string;
  /** Stable error code only — never raw internal messages. */
  errorSummary: AuditErrorCode | null;
  startedAt: Date;
  finishedAt: Date | null;
}>;

export type AuditRunServiceDeps = Readonly<{
  createModel?: (config: ModelRuntimeConfig) => LanguageModel;
  resolveEncryptionKey?: () => string;
  resolveModelConfig?: () => ModelRuntimeConfig;
  /** Defaults to env-backed tracer (noop when observability unset). */
  tracer?: AuditTracer;
  /** Test seam — defaults to createAuditTracer when tracer is unset. */
  createTracer?: () => AuditTracer;
}>;

function auditStatusFor(input: Readonly<{
  exhausted: boolean;
  failureCount: number;
}>): AuditStartResult["status"] {
  if (input.failureCount > 0 && !input.exhausted) return "partial_failure";
  if (input.failureCount > 0) return "failed";
  if (!input.exhausted) return "bounded_incomplete";
  return "completed";
}

function asErrorCode(caught: unknown): AuditErrorCode {
  if (caught instanceof AuditLeaseLostError) return "lease_lost";
  if (caught instanceof JudgeTransportError) return "judge_transport";
  return "audit_failed";
}

export class AuditRunService {
  constructor(
    private readonly db: Database = database(),
    private readonly deps: AuditRunServiceDeps = {},
  ) {}

  async getStatus(ownerId: string, auditRunId: string): Promise<AuditStatusView | null> {
    const [row] = await this.db
      .select({
        id: auditRun.id,
        syncRunId: auditRun.syncRunId,
        status: auditRun.status,
        processedCount: auditRun.processedCount,
        totalEligible: auditRun.totalEligible,
        nextCursor: auditRun.nextCursor,
        modelProvider: auditRun.modelProvider,
        modelName: auditRun.modelName,
        promptVersionId: auditRun.promptVersionId,
        errorSummary: auditRun.errorSummary,
        startedAt: auditRun.startedAt,
        finishedAt: auditRun.finishedAt,
      })
      .from(auditRun)
      .where(and(eq(auditRun.id, auditRunId), eq(auditRun.ownerAuthUserId, ownerId)))
      .limit(1);
    if (!row) return null;
    return {
      ...row,
      status: row.status as AuditRunStatus,
      errorSummary: row.errorSummary && AUDIT_ERROR_CODE_SET.has(row.errorSummary)
        ? (row.errorSummary as AuditErrorCode)
        : (row.errorSummary ? "audit_failed" : null),
    };
  }

  async start(ownerId: string, options: AuditStartOptions): Promise<AuditStartResult> {
    const concurrency = options.concurrency ?? DEFAULT_AUDIT_CONCURRENCY;
    const maxMessages = options.maxMessages ?? DEFAULT_AUDIT_MAX_MESSAGES;

    const [config] = await this.db
      .select({
        categoryIntent: triageConfig.categoryIntent,
      })
      .from(triageConfig)
      .where(eq(triageConfig.ownerAuthUserId, ownerId))
      .orderBy(desc(triageConfig.version))
      .limit(1);
    if (!config) throw new AuditClientError("Sync configuration missing");
    const categoryIntent = asCategoryIntent(config.categoryIntent);
    if (!hasCompleteCategoryIntent(categoryIntent)) {
      throw new AuditClientError(
        "Category intent is required for every category before starting an audit run",
      );
    }

    const [sync] = await this.db
      .select({
        id: syncRun.id,
        status: syncRun.status,
      })
      .from(syncRun)
      .where(and(eq(syncRun.id, options.syncRunId), eq(syncRun.ownerAuthUserId, ownerId)))
      .limit(1);
    if (!sync) throw new AuditClientError("Sync run not found");
    if (sync.status !== "completed") {
      throw new AuditClientError("Audit requires a completed sync run");
    }

    let resumeRunId = options.auditRunId ?? null;
    if (!resumeRunId) {
      const [checkpoint] = await this.db
        .select({ id: auditRun.id })
        .from(auditRun)
        .where(and(
          eq(auditRun.ownerAuthUserId, ownerId),
          eq(auditRun.syncRunId, options.syncRunId),
          sql`${auditRun.status} IN ('bounded_incomplete', 'partial_failure')`,
        ))
        .orderBy(desc(auditRun.startedAt))
        .limit(1);
      resumeRunId = checkpoint?.id ?? null;
    }

    const systemPromptBody = judgeSystemPromptFor(categoryIntent);
    const promptId = promptVersionIdFor(systemPromptBody);
    await this.db
      .insert(promptVersion)
      .values({ id: promptId, body: systemPromptBody })
      .onConflictDoNothing();

    const runId = resumeRunId ?? randomUUID();
    const [lease] = await this.db
      .insert(syncLease)
      .values({
        ownerAuthUserId: ownerId,
        leaseOwner: runId,
        leaseExpiresAt: sql`now() + (${AUDIT_LEASE_SECONDS} * interval '1 second')`,
      })
      .onConflictDoUpdate({
        target: syncLease.ownerAuthUserId,
        set: {
          leaseOwner: runId,
          leaseExpiresAt: sql`now() + (${AUDIT_LEASE_SECONDS} * interval '1 second')`,
          fenceToken: sql`${syncLease.fenceToken} + 1`,
        },
        setWhere: sql`${syncLease.leaseExpiresAt} <= now()`,
      })
      .returning({ fenceToken: syncLease.fenceToken });
    if (!lease) throw new AuditAlreadyRunningError();

    // Resolve model/secrets only after lease — keeps lease-refusal tests env-independent.
    const modelConfig = (this.deps.resolveModelConfig ?? getModelConfig)();
    const encryptionKey = (this.deps.resolveEncryptionKey ?? (() => getServerConfig().tokenEncryptionKeyV1))();

    let malformedCount = 0;
    let processedCount = 0;
    let totalEligible = 0;
    let nextCursor: string | null = null;
    let status: AuditStartResult["status"] = "failed";
    let errorCode: AuditErrorCode | null = null;
    const ownsTracer = this.deps.tracer === undefined;
    let tracer: AuditTracer | undefined = this.deps.tracer;

    try {
      const activeTracer = tracer ?? (this.deps.createTracer ?? createAuditTracer)();
      tracer = activeTracer;
      return await withAuditRunSpan(
        activeTracer,
        { runId, syncRunId: options.syncRunId },
        async (runSpan) => {
      if (resumeRunId) {
        const [existing] = await this.db
          .select({
            id: auditRun.id,
            processedCount: auditRun.processedCount,
            totalEligible: auditRun.totalEligible,
          })
          .from(auditRun)
          .where(and(eq(auditRun.id, resumeRunId), eq(auditRun.ownerAuthUserId, ownerId)))
          .limit(1);
        if (!existing) throw new AuditClientError("Invalid audit checkpoint");
        await this.db
          .update(auditRun)
          .set({
            status: "running",
            leaseOwner: runId,
            leaseExpiresAt: sql`now() + (${AUDIT_LEASE_SECONDS} * interval '1 second')`,
            fenceToken: lease.fenceToken,
            finishedAt: null,
            errorSummary: null,
            promptVersionId: promptId,
            modelProvider: modelConfig.provider,
            modelName: modelConfig.modelName,
          })
          .where(eq(auditRun.id, resumeRunId));
        processedCount = existing.processedCount;
        totalEligible = existing.totalEligible;
      } else {
        await this.db.insert(auditRun).values({
          id: runId,
          ownerAuthUserId: ownerId,
          syncRunId: options.syncRunId,
          status: "running",
          promptVersionId: promptId,
          modelProvider: modelConfig.provider,
          modelName: modelConfig.modelName,
          processedCount: 0,
          totalEligible: 0,
          leaseOwner: runId,
          leaseExpiresAt: sql`now() + (${AUDIT_LEASE_SECONDS} * interval '1 second')`,
          fenceToken: lease.fenceToken,
        });
      }

      const snapshotStore = new DatabaseMessageSnapshotStore(this.db);
      const snapshots = await snapshotStore.listByRunId(ownerId, options.syncRunId);
      const outcomes = await this.db
        .select({
          gmailMessageId: messageProcessing.gmailMessageId,
          outcome: messageProcessing.outcome,
        })
        .from(messageProcessing)
        .where(eq(messageProcessing.runId, options.syncRunId));

      const judgedRows = await this.db
        .select({ gmailMessageId: verdict.gmailMessageId })
        .from(verdict)
        .where(eq(verdict.auditRunId, runId));
      const alreadyJudged = new Set(judgedRows.map((row) => row.gmailMessageId));

      const built = buildAuditCandidates({
        snapshots,
        outcomes: outcomes.map((row) => ({
          gmailMessageId: row.gmailMessageId,
          outcome: row.outcome as ClassificationOutcome | "failed" | null,
        })),
        encryptionKey,
        alreadyJudgedIds: alreadyJudged,
      });
      const allCandidates = built.candidates;
      const decryptFailureCount = built.decryptFailures.length;
      if (!resumeRunId) {
        totalEligible = allCandidates.length + alreadyJudged.size + decryptFailureCount;
      } else if (totalEligible === 0) {
        totalEligible = allCandidates.length + alreadyJudged.size + decryptFailureCount;
      }

      const batch = allCandidates.slice(0, maxMessages);
      const remainingAfterBatch = allCandidates.slice(batch.length);
      const exhausted = remainingAfterBatch.length === 0 && decryptFailureCount === 0;
      nextCursor = remainingAfterBatch[0]?.gmailMessageId ?? null;

      const exemplars = await this.loadExemplars(ownerId);
      const exemplarsByCategory = selectExemplarsByCategory(exemplars);
      const model = (this.deps.createModel ?? createJudgeModel)(modelConfig);

      let lastRenewAt = 0;
      const renewLease = async (): Promise<void> => {
        const now = Date.now();
        if (lastRenewAt > 0 && now - lastRenewAt < LEASE_RENEW_INTERVAL_MS) return;
        const [renewed] = await this.db
          .update(syncLease)
          .set({
            leaseExpiresAt: sql`now() + (${AUDIT_LEASE_SECONDS} * interval '1 second')`,
          })
          .where(and(
            eq(syncLease.ownerAuthUserId, ownerId),
            eq(syncLease.leaseOwner, runId),
            eq(syncLease.fenceToken, lease.fenceToken),
            sql`${syncLease.leaseExpiresAt} > now()`,
          ))
          .returning({ fenceToken: syncLease.fenceToken });
        if (!renewed) throw new AuditLeaseLostError();
        lastRenewAt = now;
      };

      let leaseLost = false;
      let transportFailed = false;
      try {
        await runAuditBatch({
          messages: batch,
          concurrency,
          judge: async (message: AuditBatchMessage) => {
            await renewLease();
            const prompt = assembleJudgePrompt({
              categoryIntent,
              message: {
                from: message.from,
                subject: message.subject,
                bodyText: message.bodyText,
                deterministicOutcome: message.outcome,
              },
              exemplars: exemplarsByCategory,
            });
            const judged = await withJudgeSpan(
              activeTracer,
              { runId, gmailMessageId: message.gmailMessageId },
              () => judgeMessage({
                model,
                system: prompt.system,
                user: prompt.user,
                tags: {
                  model: modelConfig.modelName,
                  provider: modelConfig.provider,
                  promptVersion: promptId,
                },
              }),
            );
            if (judged.malformed) malformedCount += 1;
            const inserted = await this.db
              .insert(verdict)
              .values({
                auditRunId: runId,
                gmailMessageId: message.gmailMessageId,
                agreesWithFiling: judged.agreesWithFiling,
                recommendedCategory: judged.recommendedCategory,
                rationale: judged.rationale,
                malformed: judged.malformed,
                modelName: judged.model,
                modelProvider: judged.provider,
                promptVersionId: judged.promptVersion,
              })
              .onConflictDoNothing()
              .returning({ gmailMessageId: verdict.gmailMessageId });
            if (inserted.length > 0) processedCount += 1;
            return judged;
          },
        });
      } catch (caught) {
        if (caught instanceof AuditLeaseLostError) {
          leaseLost = true;
          errorCode = "lease_lost";
        } else if (caught instanceof JudgeTransportError) {
          transportFailed = true;
          errorCode = "judge_transport";
        } else {
          throw caught;
        }
      }

      const failureCount = (leaseLost ? 1 : 0)
        + (transportFailed ? 1 : 0)
        + decryptFailureCount;
      if (decryptFailureCount > 0 && errorCode === null) errorCode = "decrypt_failed";

      status = auditStatusFor({
        exhausted: exhausted && !leaseLost && !transportFailed,
        failureCount,
      });
      if ((leaseLost || transportFailed) && batch.length > 0) {
        const judgedNow = await this.db
          .select({ gmailMessageId: verdict.gmailMessageId })
          .from(verdict)
          .where(eq(verdict.auditRunId, runId));
        const judgedSet = new Set(judgedNow.map((row) => row.gmailMessageId));
        nextCursor = batch.find((row) => !judgedSet.has(row.gmailMessageId))?.gmailMessageId
          ?? remainingAfterBatch[0]?.gmailMessageId
          ?? null;
      }

      await this.db
        .update(auditRun)
        .set({
          status,
          processedCount,
          totalEligible,
          nextCursor,
          finishedAt: sql`now()`,
          leaseOwner: null,
          leaseExpiresAt: null,
          errorSummary: errorCode,
        })
        .where(and(
          eq(auditRun.id, runId),
          eq(auditRun.fenceToken, lease.fenceToken),
        ));

      runSpan.setAttribute("audit.status", status);

      return {
        id: runId,
        syncRunId: options.syncRunId,
        status,
        processedCount,
        totalEligible,
        nextCursor,
        malformedCount,
        errorCode,
      };
        },
      );
    } catch (caught) {
      errorCode = asErrorCode(caught);
      await this.db
        .update(auditRun)
        .set({
          status: "failed",
          errorSummary: errorCode,
          finishedAt: sql`now()`,
          leaseOwner: null,
          leaseExpiresAt: null,
        })
        .where(and(
          eq(auditRun.id, runId),
          eq(auditRun.fenceToken, lease.fenceToken),
        ));
      throw caught;
    } finally {
      if (tracer) {
        await tracer.forceFlush().catch(() => undefined);
        if (ownsTracer) await tracer.shutdown().catch(() => undefined);
      }
      await this.db
        .delete(syncLease)
        .where(and(
          eq(syncLease.ownerAuthUserId, ownerId),
          eq(syncLease.leaseOwner, runId),
          eq(syncLease.fenceToken, lease.fenceToken),
        ));
    }
  }

  private async loadExemplars(ownerId: string): Promise<readonly ExemplarSnippet[]> {
    // Stable first-N: order by fixture id then row id so selectExemplarsByCategory is reproducible.
    const rows = await this.db
      .select({
        fixtureId: goldenSetMessage.fixtureId,
        fromAddress: goldenSetMessage.fromAddress,
        subject: goldenSetMessage.subject,
        bodyText: goldenSetMessage.bodyText,
        ownerLabel: goldenSetMessage.ownerLabel,
      })
      .from(goldenSetMessage)
      .where(and(
        eq(goldenSetMessage.ownerAuthUserId, ownerId),
        eq(goldenSetMessage.partition, "exemplar"),
      ))
      .orderBy(goldenSetMessage.fixtureId, goldenSetMessage.id);
    return rows.map((row) => ({
      id: row.fixtureId ?? undefined,
      from: row.fromAddress,
      subject: row.subject,
      bodyText: row.bodyText,
      ownerLabel: row.ownerLabel as Category,
    }));
  }
}
