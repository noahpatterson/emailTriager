import { ownedRunOrNull } from "./run-detail-map";

export type DeleteRunResult = "deleted" | "not_found";

/** Explicit child-then-parent plan for neon-http (no transactions) and demo FORCE RLS. */
export type DeleteRunSteps = Readonly<{
  runId: string;
  ownerId: string;
  deleteAuditDependents: true;
  deleteMessageSnapshots: true;
  deleteMessageProcessing: true;
  clearGmailMessageState: true;
  deleteSyncRun: true;
}>;

/** Null when the run is missing or belongs to another owner. */
export function planOwnedRunDeletion(
  run: { id: string; ownerAuthUserId: string } | undefined,
  ownerId: string,
  runId: string,
): DeleteRunSteps | null {
  const owned = ownedRunOrNull(run, ownerId);
  if (!owned || owned.id !== runId) return null;
  return {
    runId: owned.id,
    ownerId,
    deleteAuditDependents: true,
    deleteMessageSnapshots: true,
    deleteMessageProcessing: true,
    clearGmailMessageState: true,
    deleteSyncRun: true,
  };
}

export async function executeDeleteRunSteps(
  steps: DeleteRunSteps,
  ops: {
    deleteAuditDependentsForRun: (runId: string, ownerId: string) => Promise<void>;
    deleteMessageSnapshotsForRun: (runId: string) => Promise<void>;
    deleteMessageProcessingForRun: (runId: string) => Promise<void>;
    clearGmailMessageStateForRun: (runId: string) => Promise<void>;
    deleteSyncRunForOwner: (runId: string, ownerId: string) => Promise<void>;
  },
): Promise<"deleted"> {
  // Children first — CASCADE is unreliable under demo FORCE RLS; neon-http has no txn.
  await ops.deleteAuditDependentsForRun(steps.runId, steps.ownerId);
  await ops.deleteMessageSnapshotsForRun(steps.runId);
  await ops.deleteMessageProcessingForRun(steps.runId);
  await ops.clearGmailMessageStateForRun(steps.runId);
  await ops.deleteSyncRunForOwner(steps.runId, steps.ownerId);
  return "deleted";
}
