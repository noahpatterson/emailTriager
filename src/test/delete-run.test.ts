import { describe, expect, test } from "bun:test";
import {
  executeDeleteRunSteps,
  planOwnedRunDeletion,
  type DeleteRunSteps,
} from "../server/gmail/delete-run-plan";

describe("planOwnedRunDeletion", () => {
  test("unknown id yields no-op plan", () => {
    expect(planOwnedRunDeletion(undefined, "owner-1", "run-1")).toBeNull();
  });

  test("wrong owner yields no-op plan", () => {
    expect(planOwnedRunDeletion(
      { id: "run-1", ownerAuthUserId: "other" },
      "owner-1",
      "run-1",
    )).toBeNull();
  });

  test("id mismatch yields no-op plan", () => {
    expect(planOwnedRunDeletion(
      { id: "run-other", ownerAuthUserId: "owner-1" },
      "owner-1",
      "run-1",
    )).toBeNull();
  });

  test("owned run plans child-then-parent deletion", () => {
    expect(planOwnedRunDeletion(
      { id: "run-1", ownerAuthUserId: "owner-1" },
      "owner-1",
      "run-1",
    )).toEqual({
      runId: "run-1",
      ownerId: "owner-1",
      deleteMessageProcessing: true,
      deleteSyncRun: true,
    } satisfies DeleteRunSteps);
  });
});

describe("executeDeleteRunSteps", () => {
  test("deletes message_processing before sync_run", async () => {
    const order: string[] = [];
    const result = await executeDeleteRunSteps(
      {
        runId: "run-1",
        ownerId: "owner-1",
        deleteMessageProcessing: true,
        deleteSyncRun: true,
      },
      {
        deleteMessageProcessingForRun: async (runId) => {
          order.push(`mp:${runId}`);
        },
        deleteSyncRunForOwner: async (runId, ownerId) => {
          order.push(`run:${runId}:${ownerId}`);
        },
      },
    );
    expect(result).toBe("deleted");
    expect(order).toEqual(["mp:run-1", "run:run-1:owner-1"]);
  });
});
