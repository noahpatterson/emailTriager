import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { contestMessage, contestScanRun } from "../../db/schema";
import type { Database } from "../server/db";
import { ContestRunDetailService } from "../server/gmail/contest-run-detail";

const saved: typeof contestScanRun.$inferSelect = {
  id: "00000000-0000-4000-8000-000000000001", ownerAuthUserId: "owner",
  googleSubject: "saved-account", status: "bounded_incomplete", trial: false,
  scanned: 50, candidates: 1, classified: 1, skipped: 49, failed: 0,
  inputTokens: 12, outputTokens: 3, estimatedCostUsd: 0.001,
  progress: { resultMessageIds: ["message-1"] }, nextPageToken: "next-page",
  errorCode: null, startedAt: new Date("2026-10-10T12:00:00Z"), finishedAt: new Date("2026-10-10T12:01:00Z"),
};
const message: typeof contestMessage.$inferSelect = {
  ownerAuthUserId: "owner", googleSubject: "saved-account", gmailMessageId: "message-1", gmailThreadId: "thread-1",
  sender: "prize@example.test", subject: "You won", category: "winner", manualCategory: "new_contest",
  explicitWinProbability: 0.95, claimActionProbability: 0.8, confidence: 0.9,
  claimDeadline: "2026-10-31", model: "jev-test", promptVersion: "v1",
  inputTokens: 12, outputTokens: 3, labelStatus: "applied", notificationStatus: "sent", labelSnapshot: {},
  createdAt: saved.startedAt, updatedAt: saved.finishedAt!,
};

function fixture(runs: readonly (typeof saved)[] = [saved]) {
  const queries: { table: unknown; sql: string; params: unknown[] }[] = [];
  const limits: number[] = [];
  const dialect = new PgDialect();
  const db = {
    select() {
      return { from(table: unknown) {
        const rows = table === contestScanRun ? runs : [message];
        const limit = async (count: number) => { limits.push(count); return rows; };
        return { where(condition: SQL) {
          queries.push({ table, ...dialect.sqlToQuery(condition) });
          return { limit, orderBy: () => Object.assign(Promise.resolve(rows), { limit }) };
        } };
      } };
    },
  } as unknown as Database;
  return { service: new ContestRunDetailService(db), queries, limits };
}

describe("saved Jev run details", () => {
  test("reads only the owner's run and its saved account and batch message membership", async () => {
    const state = fixture();
    const detail = await state.service.get("owner", saved.id, "https://mail.google.com/mail/u/2/");
    expect(state.queries[0]?.params).toEqual(["owner", saved.id]);
    expect(state.queries[0]?.sql).toContain('"owner_auth_user_id"');
    expect(state.queries[1]?.table).toBe(contestMessage);
    expect(state.queries[1]?.params).toEqual(["owner", "saved-account", "message-1"]);
    expect(state.queries[1]?.sql).toContain('"google_subject"');
    expect(state.queries[1]?.sql).toContain('"gmail_message_id" in');
    expect(detail?.run.nextPageToken).toBe("next-page");
    expect(detail?.results[0]?.manualCategory).toBe("new_contest");
    expect(detail?.results[0]?.gmailUrl).toBe("https://mail.google.com/mail/u/2/#all/thread-1");
  });

  test("never substitutes persisted live classifications for an unsaved trial preview", async () => {
    const state = fixture([{ ...saved, trial: true }]);
    const detail = await state.service.get("owner", saved.id, "https://mail.google.com/mail/u/0/");
    expect(detail?.results).toEqual([]);
    expect(state.queries).toHaveLength(1);
  });

  test("does not read message data when the owner has no matching run", async () => {
    const state = fixture([]);
    expect(await state.service.get("other-owner", saved.id, "https://mail.google.com/mail/u/0/")).toBeNull();
    expect(state.queries[0]?.params).toEqual(["other-owner", saved.id]);
    expect(state.queries).toHaveLength(1);
  });

  test("loads bounded owner history and projects stale runs without changing the saved cursor", async () => {
    const state = fixture([{ ...saved, status: "running", finishedAt: null }]);
    const history = await state.service.history("owner");
    expect(state.queries[0]?.params).toEqual(["owner"]);
    expect(state.limits).toEqual([30]);
    expect(history[0]).toMatchObject({ status: "failed", errorCode: "scan_interrupted", nextPageToken: "next-page" });
  });
});
