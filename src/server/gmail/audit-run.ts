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
  assertCompleteCategoryIntent,
} from "@/src/server/config/triage-validate";
import { database, type Database } from "@/src/server/db";
import {
  DEFAULT_AUDIT_CONCURRENCY,
  DEFAULT_AUDIT_MAX_MESSAGES,
  runAuditBatch,
  type AuditBatchMessage,
} from "@/src/server/gmail/audit-batch";
import { buildAuditCandidates } from "@/src/server/gmail/audit-candidates";
import { judgeMessage } from "@/src/server/gmail/judge";
import {
  assembleJudgePrompt,
  selectExemplarsByCategory,
  type ExemplarSnippet,
} from "@/src/server/gmail/judge-prompt";
import { DatabaseMessageSnapshotStore } from "@/src/server/gmail/message-snapshot-store";
import {
  createJudgeModel,
  getModelConfig,
  type ModelRuntimeConfig,
} from "@/src/server/gmail/model-config";
import {
  JUDGE_PROMPT_VERSION_BODY,
  promptVersionIdFor,
} from "@/src/server/gmail/prompt-version";
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
}>;

export type AuditStatusView = Readonly<{
  id: string;
  syncRunId: string;
  status: string;
  processedCount: number;
  totalEligible: number;
  nextCursor: string | null;
  modelProvider: string;
  modelName: string;
  promptVersionId: string;
  errorSummary: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}>;

export type AuditRunServiceDeps = Readonly<{
  createModel?: (config: ModelRuntimeConfig) => LanguageModel;
  resolveEncryptionKey?: () => string;
  resolveModelConfig?: () => ModelRuntimeConfig;
  /** Defaults to env-backed tracer (noop when observability unset). */
  tracer?: AuditTracer;
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
    return row ?? null;
  }

  async start(ownerId: string, options: AuditStartOptions): Promise<AuditStartResult> {
    const modelConfig = (this.deps.resolveModelConfig ?? getModelConfig)();
    const encryptionKey = (this.deps.resolveEncryptionKey ?? (() => getServerConfig().tokenEncryptionKeyV1))();
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
    if (!config) throw new Error("Sync configuration missing");
    const categoryIntent = asCategoryIntent(config.categoryIntent);
    assertCompleteCategoryIntent(categoryIntent);

    const [sync] = await this.db
      .select({
        id: syncRun.id,
        status: syncRun.status,
      })
      .from(syncRun)
      .where(and(eq(syncRun.id, options.syncRunId), eq(syncRun.ownerAuthUserId, ownerId)))
      .limit(1);
    if (!sync) throw new Error("Sync run not found");
    if (sync.status !== "completed") {
      throw new Error("Audit requires a completed sync run");
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

    const promptId = promptVersionIdFor();
    await this.db
      .insert(promptVersion)
      .values({ id: promptId, body: JUDGE_PROMPT_VERSION_BODY })
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
    if (!lease) throw new Error("Synchronization already running");

    let malformedCount = 0;
    let processedCount = 0;
    let totalEligible = 0;
    let nextCursor: string | null = null;
    let status: AuditStartResult["status"] = "failed";
    const ownsTracer = this.deps.tracer === undefined;
    const tracer = this.deps.tracer ?? createAuditTracer();

    try {
      return await withAuditRunSpan(
        tracer,
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
        if (!existing) throw new Error("Invalid audit checkpoint");
        await this.db
          .update(auditRun)
          .set({
            status: "running",
            leaseOwner: runId,
            leaseExpiresAt: sql`now() + (${AUDIT_LEASE_SECONDS} * interval '1 second')`,
            fenceToken: lease.fenceToken,
            finishedAt: null,
            errorSummary: null,
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

      const allCandidates = buildAuditCandidates({
        snapshots,
        outcomes: outcomes.map((row) => ({
          gmailMessageId: row.gmailMessageId,
          outcome: row.outcome as ClassificationOutcome | "failed" | null,
        })),
        encryptionKey,
        alreadyJudgedIds: alreadyJudged,
      });
      if (!resumeRunId) {
        totalEligible = allCandidates.length + alreadyJudged.size;
      } else if (totalEligible === 0) {
        totalEligible = allCandidates.length + alreadyJudged.size;
      }

      const batch = allCandidates.slice(0, maxMessages);
      const remainingAfterBatch = allCandidates.slice(batch.length);
      const exhausted = remainingAfterBatch.length === 0;
      // Resume progress is verdict rows already persisted; cursor points at the next pending id.
      nextCursor = remainingAfterBatch[0]?.gmailMessageId ?? null;

      const exemplars = await this.loadExemplars(ownerId);
      const exemplarsByCategory = selectExemplarsByCategory(exemplars);
      const model = (this.deps.createModel ?? createJudgeModel)(modelConfig);

      const renewLease = async (): Promise<void> => {
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
        if (!renewed) throw new Error("Audit lease lost");
      };

      let leaseLost = false;
      try {
        const batchVerdicts = await runAuditBatch({
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
                deterministicOutcome: message.outcome as ClassificationOutcome,
              },
              exemplars: exemplarsByCategory,
            });
            const judged = await withJudgeSpan(
              tracer,
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
        void batchVerdicts;
      } catch (caught) {
        if (caught instanceof Error && caught.message.includes("lease lost")) {
          leaseLost = true;
        } else {
          throw caught;
        }
      }

      status = auditStatusFor({
        exhausted: exhausted && !leaseLost,
        failureCount: leaseLost ? 1 : 0,
      });
      if (leaseLost && nextCursor === null && batch.length > 0) {
        // Lease lost mid-batch: point cursor at first message still missing a verdict.
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
          errorSummary: leaseLost ? "Audit lease lost" : null,
        })
        .where(eq(auditRun.id, runId));

      runSpan.setAttribute("audit.status", status);

      return {
        id: runId,
        syncRunId: options.syncRunId,
        status,
        processedCount,
        totalEligible,
        nextCursor,
        malformedCount,
      };
        },
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Audit failed";
      await this.db
        .update(auditRun)
        .set({
          status: "failed",
          errorSummary: message.slice(0, 500),
          finishedAt: sql`now()`,
          leaseOwner: null,
          leaseExpiresAt: null,
        })
        .where(eq(auditRun.id, runId));
      throw caught;
    } finally {
      await tracer.forceFlush().catch(() => undefined);
      if (ownsTracer) await tracer.shutdown().catch(() => undefined);
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
      ));
    return rows.map((row) => ({
      id: row.fixtureId ?? undefined,
      from: row.fromAddress,
      subject: row.subject,
      bodyText: row.bodyText,
      ownerLabel: row.ownerLabel as Category,
    }));
  }
}
