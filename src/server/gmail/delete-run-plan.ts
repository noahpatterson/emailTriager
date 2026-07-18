import { ownedRunOrNull } from "./run-detail-map";

export type DeleteRunResult = "deleted" | "not_found";

/** Explicit child-then-parent plan for neon-http (no transactions). */
export type DeleteRunSteps = Readonly<{
  runId: string;
  ownerId: string;
  deleteMessageProcessing: true;
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
    deleteMessageProcessing: true,
    deleteSyncRun: true,
  };
}

export async function executeDeleteRunSteps(
  steps: DeleteRunSteps,
  ops: {
    deleteMessageProcessingForRun: (runId: string) => Promise<void>;
    deleteSyncRunForOwner: (runId: string, ownerId: string) => Promise<void>;
  },
): Promise<"deleted"> {
  // Children first — required when FK is still ON DELETE NO ACTION; safe with CASCADE too.
  await ops.deleteMessageProcessingForRun(steps.runId);
  await ops.deleteSyncRunForOwner(steps.runId, steps.ownerId);
  return "deleted";
}
