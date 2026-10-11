import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { contestMessage, contestScanRun, contestSettings, gmailConnection, ownerBinding, syncLease, triageConfig } from "@/db/schema";
import { database, type Database } from "@/src/server/db";
import type { ClassificationTerms } from "./classify";
import type { ContestCategory } from "./contest-classify";
import type { ContestLabels, ContestResultRow, ContestRunSummary, ContestSettings, ContestScanProgress } from "./contest-contracts";
import { gmailMessageUrl } from "./gmail-url";

export type ContestContext = Readonly<{
  ownerId: string; googleSubject: string; sourceLabelId: string; terms: ClassificationTerms;
  senderWhitelist: readonly string[]; senderBlocklist: readonly string[]; linkRoot: string;
}>;
export type ContestLease = Readonly<{ ownerId: string; googleSubject: string; leaseOwner: string; fenceToken: number }>;
export type StoredContestMessage = Readonly<{ row: ContestResultRow; labels: ContestLabels }>;
export interface ContestStore {
  context(ownerId: string): Promise<ContestContext | null>;
  settings(context: ContestContext): Promise<ContestSettings | null>;
  configure(context: ContestContext, labels: ContestLabels, lease: ContestLease): Promise<void>;
  acquire(context: ContestContext, leaseOwner: string): Promise<ContestLease | null>;
  renew(lease: ContestLease): Promise<boolean>;
  assertLease(lease: ContestLease): Promise<void>;
  release(lease: ContestLease): Promise<void>;
  recoverable(context: ContestContext, includeNotifications?: boolean): Promise<readonly StoredContestMessage[]>;
  results(context: ContestContext, messageIds: readonly string[]): Promise<readonly StoredContestMessage[]>;
  message(context: ContestContext, id: string): Promise<StoredContestMessage | null>;
  save(context: ContestContext, lease: ContestLease, row: ContestResultRow, labels: ContestLabels): Promise<StoredContestMessage>;
  correct(context: ContestContext, lease: ContestLease, id: string, category: ContestCategory): Promise<void>;
  labelStatus(context: ContestContext, lease: ContestLease, id: string, status: ContestResultRow["labelStatus"]): Promise<void>;
  latestRun(context: ContestContext): Promise<ContestRunSummary | null>;
  saveRun(context: ContestContext, run: ContestRunSummary): Promise<void>;
  reserveNotification(ownerId: string, googleSubject: string, messageId: string): Promise<boolean>;
  finishNotification(ownerId: string, googleSubject: string, messageId: string, status: "sent" | "failed" | "uncertain"): Promise<void>;
}
export class ContestLeaseLostError extends Error { constructor() { super("Contest lease lost"); } }

type MessageRecord = typeof contestMessage.$inferSelect;
export function mapContestMessage(record: MessageRecord, linkRoot: string): StoredContestMessage {
  const row: ContestResultRow = {
    gmailMessageId: record.gmailMessageId, gmailThreadId: record.gmailThreadId,
    sender: record.sender, subject: record.subject, category: record.category as ContestCategory,
    manualCategory: record.manualCategory as ContestCategory | null,
    explicitWinProbability: record.explicitWinProbability, claimActionProbability: record.claimActionProbability,
    confidence: record.confidence, claimDeadline: record.claimDeadline, model: record.model, promptVersion: record.promptVersion,
    inputTokens: record.inputTokens, outputTokens: record.outputTokens,
    labelStatus: record.labelStatus as ContestResultRow["labelStatus"],
    notificationStatus: record.notificationStatus as ContestResultRow["notificationStatus"],
    gmailUrl: gmailMessageUrl(record, linkRoot),
  };
  return { row, labels: record.labelSnapshot as ContestLabels };
}
export function mapContestRun(row: typeof contestScanRun.$inferSelect): ContestRunSummary {
  const progress = row.progress as ContestScanProgress | null;
  return {
    id: row.id, status: row.status, trial: row.trial,
    scanned: row.scanned, candidates: row.candidates, classified: row.classified,
    skipped: row.skipped, failed: row.failed, inputTokens: row.inputTokens, outputTokens: row.outputTokens,
    estimatedCostUsd: row.estimatedCostUsd, progress, nextPageToken: row.nextPageToken,
    errorCode: row.errorCode,
    startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
function connected(ownerId: string, subject: string) {
  return sql`EXISTS (SELECT 1 FROM gmail_connection WHERE owner_auth_user_id = ${ownerId} AND google_subject = ${subject} AND disconnected_at IS NULL)`;
}
function fence(lease: ContestLease) {
  return sql`EXISTS (SELECT 1 FROM sync_lease WHERE owner_auth_user_id = ${lease.ownerId} AND lease_owner = ${lease.leaseOwner}::uuid AND fence_token = ${lease.fenceToken} AND lease_expires_at > now()) AND ${connected(lease.ownerId, lease.googleSubject)}`;
}

export class DatabaseContestStore implements ContestStore {
  private readonly activeLeases = new Map<string, ContestLease>();
  constructor(private readonly db: Database = database()) {}
  async context(ownerId: string): Promise<ContestContext | null> {
    const [row] = await this.db.select({ googleSubject: gmailConnection.googleSubject, sourceLabelId: triageConfig.sourceLabelId, terms: triageConfig.terms, senderWhitelist: triageConfig.senderWhitelist, senderBlocklist: triageConfig.senderBlocklist, linkRoot: ownerBinding.gmailMessageLinkRoot })
      .from(gmailConnection).innerJoin(triageConfig, eq(triageConfig.ownerAuthUserId, gmailConnection.ownerAuthUserId)).innerJoin(ownerBinding, eq(ownerBinding.authUserId, gmailConnection.ownerAuthUserId))
      .where(and(eq(gmailConnection.ownerAuthUserId, ownerId), isNull(gmailConnection.disconnectedAt))).orderBy(desc(triageConfig.version)).limit(1);
    return row ? { ...row, ownerId, terms: row.terms as ClassificationTerms, senderWhitelist: row.senderWhitelist as readonly string[], senderBlocklist: row.senderBlocklist as readonly string[] } : null;
  }
  async settings(context: ContestContext): Promise<ContestSettings | null> {
    const [row] = await this.db.select().from(contestSettings).where(and(eq(contestSettings.ownerAuthUserId, context.ownerId), eq(contestSettings.googleSubject, context.googleSubject))).limit(1);
    return row ? { labels: row.labels as ContestLabels } : null;
  }
  async configure(context: ContestContext, labels: ContestLabels, lease: ContestLease) {
    await this.db.execute(sql`INSERT INTO contest_settings (owner_auth_user_id, google_subject, labels) SELECT ${context.ownerId}, ${context.googleSubject}, ${JSON.stringify(labels)}::jsonb WHERE ${fence(lease)} ON CONFLICT (owner_auth_user_id) DO UPDATE SET google_subject = EXCLUDED.google_subject, labels = EXCLUDED.labels, updated_at = now()`);
  }
  async acquire(context: ContestContext, leaseOwner: string): Promise<ContestLease | null> {
    const [row] = await this.db.insert(syncLease).values({ ownerAuthUserId: context.ownerId, leaseOwner, leaseExpiresAt: sql`now() + interval '300 seconds'` }).onConflictDoUpdate({ target: syncLease.ownerAuthUserId, set: { leaseOwner, leaseExpiresAt: sql`now() + interval '300 seconds'`, fenceToken: sql`${syncLease.fenceToken} + 1` }, setWhere: sql`${syncLease.leaseExpiresAt} <= now() AND ${connected(context.ownerId, context.googleSubject)}` }).returning({ fenceToken: syncLease.fenceToken });
    if (!row) return null;
    const lease = { ownerId: context.ownerId, googleSubject: context.googleSubject, leaseOwner, fenceToken: row.fenceToken };
    this.activeLeases.set(context.ownerId, lease);
    return lease;
  }
  async renew(lease: ContestLease) {
    const rows = await this.db.update(syncLease).set({ leaseExpiresAt: sql`now() + interval '300 seconds'` }).where(and(eq(syncLease.ownerAuthUserId, lease.ownerId), fence(lease))).returning({ fenceToken: syncLease.fenceToken });
    return rows.length > 0;
  }
  async assertLease(lease: ContestLease) {
    const rows = await this.db.select({ id: syncLease.ownerAuthUserId }).from(syncLease).where(and(eq(syncLease.ownerAuthUserId, lease.ownerId), fence(lease))).limit(1);
    if (!rows.length) throw new ContestLeaseLostError();
  }
  async release(lease: ContestLease) {
    if (this.activeLeases.get(lease.ownerId)?.leaseOwner === lease.leaseOwner) this.activeLeases.delete(lease.ownerId);
    await this.db.update(syncLease).set({ leaseExpiresAt: sql`now()` }).where(and(eq(syncLease.ownerAuthUserId, lease.ownerId), eq(syncLease.leaseOwner, lease.leaseOwner), eq(syncLease.fenceToken, lease.fenceToken)));
  }
  async recoverable(context: ContestContext, includeNotifications = false) {
    const rows = await this.db.select().from(contestMessage).where(and(eq(contestMessage.ownerAuthUserId, context.ownerId), eq(contestMessage.googleSubject, context.googleSubject), or(eq(contestMessage.labelStatus, "pending"), includeNotifications ? and(eq(contestMessage.labelStatus, "applied"), or(isNull(contestMessage.notificationStatus), eq(contestMessage.notificationStatus, "failed")), sql`COALESCE(${contestMessage.manualCategory},${contestMessage.category}) = 'winner'`, sql`${contestMessage.explicitWinProbability} >= 0.9`) : sql`false`))).orderBy(sql`CASE WHEN ${contestMessage.labelStatus} = 'pending' THEN 0 ELSE 1 END`, contestMessage.updatedAt).limit(5);
    return rows.map((row) => mapContestMessage(row, context.linkRoot));
  }
  async results(context: ContestContext, messageIds: readonly string[]) {
    if (!messageIds.length) return [];
    const rows = await this.db.select().from(contestMessage).where(and(eq(contestMessage.ownerAuthUserId, context.ownerId), eq(contestMessage.googleSubject, context.googleSubject), inArray(contestMessage.gmailMessageId, [...messageIds]))).orderBy(desc(contestMessage.explicitWinProbability), desc(contestMessage.updatedAt)).limit(100);
    return rows.map((row) => mapContestMessage(row, context.linkRoot));
  }
  async message(context: ContestContext, id: string) {
    const [row] = await this.db.select().from(contestMessage).where(and(eq(contestMessage.ownerAuthUserId, context.ownerId), eq(contestMessage.googleSubject, context.googleSubject), eq(contestMessage.gmailMessageId, id))).limit(1);
    return row ? mapContestMessage(row, context.linkRoot) : null;
  }
  async save(context: ContestContext, lease: ContestLease, row: ContestResultRow, labels: ContestLabels) {
    await this.db.execute(sql`INSERT INTO contest_message (owner_auth_user_id,google_subject,gmail_message_id,gmail_thread_id,sender,subject,category,explicit_win_probability,claim_action_probability,confidence,claim_deadline,model,prompt_version,input_tokens,output_tokens,label_snapshot) SELECT ${context.ownerId},${context.googleSubject},${row.gmailMessageId},${row.gmailThreadId},${row.sender},${row.subject},${row.category},${row.explicitWinProbability},${row.claimActionProbability},${row.confidence},${row.claimDeadline},${row.model},${row.promptVersion},${row.inputTokens},${row.outputTokens},${JSON.stringify(labels)}::jsonb WHERE ${fence(lease)} ON CONFLICT (google_subject,gmail_message_id) DO NOTHING`);
    const saved = await this.message(context, row.gmailMessageId);
    if (!saved) throw new ContestLeaseLostError();
    return saved;
  }
  async correct(context: ContestContext, lease: ContestLease, id: string, category: ContestCategory) {
    await this.db.update(contestMessage).set({ manualCategory: category, labelStatus: "pending", updatedAt: sql`now()` }).where(and(eq(contestMessage.ownerAuthUserId, context.ownerId), eq(contestMessage.googleSubject, context.googleSubject), eq(contestMessage.gmailMessageId, id), fence(lease)));
    await this.assertLease(lease);
  }
  async labelStatus(context: ContestContext, lease: ContestLease, id: string, status: ContestResultRow["labelStatus"]) {
    await this.db.update(contestMessage).set({ labelStatus: status, updatedAt: sql`now()` }).where(and(eq(contestMessage.ownerAuthUserId, context.ownerId), eq(contestMessage.googleSubject, context.googleSubject), eq(contestMessage.gmailMessageId, id), fence(lease)));
    await this.assertLease(lease);
  }
  async latestRun(context: ContestContext): Promise<ContestRunSummary | null> {
    const [row] = await this.db.select().from(contestScanRun).where(and(eq(contestScanRun.ownerAuthUserId, context.ownerId), eq(contestScanRun.googleSubject, context.googleSubject))).orderBy(desc(contestScanRun.startedAt)).limit(1);
    return row ? mapContestRun(row) : null;
  }
  async saveRun(context: ContestContext, run: ContestRunSummary) {
    const values = { ...run, estimatedCostUsd: run.estimatedCostUsd ?? null, progress: run.progress ?? null, ownerAuthUserId: context.ownerId, googleSubject: context.googleSubject, startedAt: new Date(run.startedAt), finishedAt: run.finishedAt ? new Date(run.finishedAt) : null };
    await this.db.insert(contestScanRun).values(values).onConflictDoUpdate({ target: contestScanRun.id, set: values, setWhere: and(eq(contestScanRun.ownerAuthUserId, context.ownerId), eq(contestScanRun.googleSubject, context.googleSubject)) });
  }
  async reserveNotification(ownerId: string, googleSubject: string, messageId: string) {
    const lease = this.activeLeases.get(ownerId);
    if (!lease || lease.googleSubject !== googleSubject) return false;
    const rows = await this.db.update(contestMessage).set({ notificationStatus: "reserved", updatedAt: sql`now()` }).where(and(eq(contestMessage.ownerAuthUserId, ownerId), eq(contestMessage.googleSubject, googleSubject), eq(contestMessage.gmailMessageId, messageId), or(isNull(contestMessage.notificationStatus), eq(contestMessage.notificationStatus, "failed")), eq(contestMessage.labelStatus, "applied"), sql`COALESCE(${contestMessage.manualCategory},${contestMessage.category}) = 'winner'`, sql`${contestMessage.explicitWinProbability} >= 0.9`, fence(lease))).returning({ id: contestMessage.gmailMessageId });
    return rows.length > 0;
  }
  async finishNotification(ownerId: string, googleSubject: string, messageId: string, status: "sent" | "failed" | "uncertain") {
    await this.db.update(contestMessage).set({ notificationStatus: status, updatedAt: sql`now()` }).where(and(eq(contestMessage.ownerAuthUserId, ownerId), eq(contestMessage.googleSubject, googleSubject), eq(contestMessage.gmailMessageId, messageId), eq(contestMessage.notificationStatus, "reserved")));
  }
}
