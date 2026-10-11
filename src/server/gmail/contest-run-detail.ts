import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { contestMessage, contestScanRun } from "@/db/schema";
import { database, type Database } from "@/src/server/db";
import type { ContestResultRow, ContestRunSummary } from "./contest-contracts";
import { mapContestMessage, mapContestRun } from "./contest-store";

export type ContestRunDetailView = Readonly<{
  run: ContestRunSummary;
  results: readonly ContestResultRow[];
}>;

function visibleRun(row: typeof contestScanRun.$inferSelect): ContestRunSummary {
  const run = mapContestRun(row);
  const heartbeat = Date.parse(run.progress?.heartbeatAt ?? run.startedAt);
  return run.status === "running" && Number.isFinite(heartbeat) && Date.now() - heartbeat > 300_000
    ? { ...run, status: "failed", errorCode: "scan_interrupted" } : run;
}

export class ContestRunDetailService {
  constructor(private readonly db: Database = database()) {}

  async history(ownerId: string): Promise<readonly ContestRunSummary[]> {
    const rows = await this.db.select().from(contestScanRun)
      .where(eq(contestScanRun.ownerAuthUserId, ownerId))
      .orderBy(desc(contestScanRun.startedAt)).limit(30);
    return rows.map(visibleRun);
  }

  async get(ownerId: string, runId: string, linkRoot: string): Promise<ContestRunDetailView | null> {
    const [saved] = await this.db.select().from(contestScanRun)
      .where(and(eq(contestScanRun.ownerAuthUserId, ownerId), eq(contestScanRun.id, runId))).limit(1);
    if (!saved) return null;
    const run = visibleRun(saved);
    const ids = run.trial ? [] : run.progress?.resultMessageIds ?? [];
    if (!ids.length) return { run, results: [] };
    const messages = await this.db.select().from(contestMessage).where(and(
      eq(contestMessage.ownerAuthUserId, ownerId),
      eq(contestMessage.googleSubject, saved.googleSubject),
      inArray(contestMessage.gmailMessageId, ids),
    )).orderBy(desc(contestMessage.explicitWinProbability));
    return { run, results: messages.map(row => mapContestMessage(row, linkRoot).row) };
  }
}
