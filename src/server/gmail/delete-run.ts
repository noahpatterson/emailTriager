import "server-only";
import { and, eq } from "drizzle-orm";
import { messageProcessing, syncRun } from "@/db/schema";
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
      deleteMessageProcessingForRun: async (id) => {
        await this.db.delete(messageProcessing).where(eq(messageProcessing.runId, id));
      },
      deleteSyncRunForOwner: async (id, owner) => {
        await this.db
          .delete(syncRun)
          .where(and(eq(syncRun.id, id), eq(syncRun.ownerAuthUserId, owner)));
      },
    });
  }
}
