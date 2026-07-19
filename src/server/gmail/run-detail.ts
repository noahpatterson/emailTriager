import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { messageProcessing, syncRun, triageConfig } from "@/db/schema";
import type { RunResultRow } from "@/app/run-results";
import { database, type Database } from "@/src/server/db";
import type { GmailProvider } from "./contracts";
import type { GmailLabel } from "./labels";
import { buildRunResultRows, ownedRunOrNull } from "./run-detail-map";

export type { RunResultRow };
export { buildRunResultRows, ownedRunOrNull } from "./run-detail-map";

export type RunStatus = "running" | "bounded_incomplete" | "completed" | "partial_failure" | "failed";

export type RunDetailView = Readonly<{
  id: string;
  status: RunStatus;
  trial: boolean;
  configVersion: number;
  startedAt: string;
  finishedAt: string | null;
  errorSummary: string | null;
  results: readonly RunResultRow[];
}>;

export class RunDetailService {
  constructor(private readonly db: Database = database()) {}

  async get(ownerId: string, runId: string, provider?: GmailProvider): Promise<RunDetailView | null> {
    const [run] = await this.db
      .select({
        id: syncRun.id,
        ownerAuthUserId: syncRun.ownerAuthUserId,
        status: syncRun.status,
        trial: syncRun.trial,
        configVersion: syncRun.configVersion,
        startedAt: syncRun.startedAt,
        finishedAt: syncRun.finishedAt,
        errorSummary: syncRun.errorSummary,
      })
      .from(syncRun)
      .where(and(eq(syncRun.id, runId), eq(syncRun.ownerAuthUserId, ownerId)))
      .limit(1);
    const owned = ownedRunOrNull(run, ownerId);
    if (!owned) return null;

    const [config] = await this.db
      .select({
        sourceLabelId: triageConfig.sourceLabelId,
        priorityLabelId: triageConfig.priorityLabelId,
        reviewLabelId: triageConfig.reviewLabelId,
        newLabelId: triageConfig.newLabelId,
        archiveLabelId: triageConfig.archiveLabelId,
      })
      .from(triageConfig)
      .where(and(
        eq(triageConfig.ownerAuthUserId, ownerId),
        eq(triageConfig.version, owned.configVersion),
      ))
      .limit(1);

    const messages = await this.db
      .select({
        gmailMessageId: messageProcessing.gmailMessageId,
        gmailThreadId: messageProcessing.gmailThreadId,
        subject: messageProcessing.subject,
        senderAddress: messageProcessing.senderAddress,
        outcome: messageProcessing.outcome,
        outcomeReason: messageProcessing.outcomeReason,
        processedAt: messageProcessing.processedAt,
      })
      .from(messageProcessing)
      .where(eq(messageProcessing.runId, owned.id))
      .orderBy(asc(messageProcessing.processedAt));

    let catalog: readonly GmailLabel[] | undefined;
    if (provider) {
      try {
        catalog = await provider.listLabels();
      } catch {
        catalog = undefined;
      }
    }

    return {
      id: owned.id,
      status: owned.status,
      trial: owned.trial,
      configVersion: owned.configVersion,
      startedAt: owned.startedAt.toISOString(),
      finishedAt: owned.finishedAt?.toISOString() ?? null,
      errorSummary: owned.errorSummary,
      results: buildRunResultRows(messages, config ?? null, catalog),
    };
  }
}
