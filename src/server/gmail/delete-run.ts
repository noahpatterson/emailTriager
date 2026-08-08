import "server-only";
import { and, eq, sql } from "drizzle-orm";
import {
  auditRun,
  gmailMessageState,
  messageProcessing,
  messageSnapshot,
  syncRun,
} from "@/db/schema";
import { database, type Database } from "@/src/server/db";
import {
  executeDeleteRunSteps,
  planOwnedRunDeletion,
  type DeleteRunResult,
} from "./delete-run-plan";

export type { DeleteRunResult, DeleteRunSteps } from "./delete-run-plan";
export { executeDeleteRunSteps, planOwnedRunDeletion } from "./delete-run-plan";

export class DeleteRunService {
  constructor(private readonly db: Database = database()) {}

  async delete(ownerId: string, runId: string): Promise<DeleteRunResult> {
    const [run] = await this.db
      .select({ id: syncRun.id, ownerAuthUserId: syncRun.ownerAuthUserId })
      .from(syncRun)
      .where(eq(syncRun.id, runId))
      .limit(1);

    const plan = planOwnedRunDeletion(run, ownerId, runId);
    if (!plan) return "not_found";

    return executeDeleteRunSteps(plan, {
      deleteAuditDependentsForRun: async (id, owner) => {
        // pending_demotion → verdict → audit_run (explicit: FORCE RLS can block CASCADE)
        await this.db.execute(sql`
          DELETE FROM pending_demotion
          WHERE owner_auth_user_id = ${owner}
            AND verdict_id IN (
              SELECT v.id FROM verdict v
              INNER JOIN audit_run ar ON ar.id = v.audit_run_id
              WHERE ar.sync_run_id = ${id}
                AND ar.owner_auth_user_id = ${owner}
            )
        `);
        await this.db.execute(sql`
          DELETE FROM verdict
          WHERE audit_run_id IN (
            SELECT id FROM audit_run
            WHERE sync_run_id = ${id}
              AND owner_auth_user_id = ${owner}
          )
        `);
        await this.db
          .delete(auditRun)
          .where(and(eq(auditRun.syncRunId, id), eq(auditRun.ownerAuthUserId, owner)));
      },
      deleteMessageSnapshotsForRun: async (id) => {
        await this.db.delete(messageSnapshot).where(eq(messageSnapshot.runId, id));
      },
      deleteMessageProcessingForRun: async (id) => {
        await this.db.delete(messageProcessing).where(eq(messageProcessing.runId, id));
      },
      clearGmailMessageStateForRun: async (id) => {
        await this.db
          .update(gmailMessageState)
          .set({ latestRunId: null })
          .where(eq(gmailMessageState.latestRunId, id));
      },
      deleteSyncRunForOwner: async (id, owner) => {
        await this.db
          .delete(syncRun)
          .where(and(eq(syncRun.id, id), eq(syncRun.ownerAuthUserId, owner)));
      },
    });
  }
}
