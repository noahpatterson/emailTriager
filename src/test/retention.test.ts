import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { RetentionService } = await import("../server/retention");

describe("retention service", () => {
  test("expires OAuth state immediately and bounded history at the configured age", async () => {
    const calls: Array<{ kind: string; cutoff: Date }> = [];
    const store = {
      async deleteExpiredOAuthState(cutoff: Date) {
        calls.push({ kind: "oauth", cutoff });
        return 2;
      },
      async deleteExpiredMessageState(cutoff: Date) {
        calls.push({ kind: "messages", cutoff });
        return 3;
      },
      async deleteExpiredSnapshots(cutoff: Date) {
        calls.push({ kind: "snapshots", cutoff });
        return 5;
      },
      async deleteExpiredRuns(cutoff: Date) {
        calls.push({ kind: "runs", cutoff });
        return 4;
      },
    };
    const now = new Date("2026-07-18T12:00:00.000Z");

    const result = await new RetentionService(store, 30).run(now);

    expect(result).toEqual({
      oauthStatesDeleted: 2,
      messageStatesDeleted: 3,
      snapshotsDeleted: 5,
      runsDeleted: 4,
    });
    expect(calls).toEqual([
      { kind: "oauth", cutoff: now },
      { kind: "messages", cutoff: new Date("2026-06-18T12:00:00.000Z") },
      { kind: "snapshots", cutoff: new Date("2026-06-18T12:00:00.000Z") },
      { kind: "runs", cutoff: new Date("2026-06-18T12:00:00.000Z") },
    ]);
  });
});
