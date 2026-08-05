import "server-only";
import { and, eq } from "drizzle-orm";
import { evalRun, goldenSetMessage } from "@/db/schema";
import { database, type Database } from "@/src/server/db";
import type { ClassificationTerms } from "@/src/server/gmail/classify";
import { ADVERSARIAL_CORPUS } from "@/src/server/gmail/corpus";
import {
  corpusFixtureToGoldenRow,
  runMatchingEval,
  type GoldenSetRow,
  type MatchingEvalMetrics,
} from "@/src/server/gmail/matching-eval";
import type { SyncBounds } from "@/src/server/gmail/sync";
import { ensureOwnerBinding as writeOwnerBinding } from "@/src/server/owner-binding";

export type MatchingEvalCandidate = Readonly<{
  terms: ClassificationTerms;
  bounds?: SyncBounds;
}>;

export type MatchingEvalRunResult = Readonly<{
  id: string;
  metrics: MatchingEvalMetrics;
  candidate: MatchingEvalCandidate;
}>;

export class MatchingEvalService {
  constructor(private readonly db: Database = database()) {}

  async ensureOwnerBinding(ownerId: string): Promise<void> {
    await writeOwnerBinding(this.db, ownerId);
  }

  /** Idempotently seed adversarial corpus fixtures into the owner's Golden Set. */
  async ensureCorpusGoldenSet(ownerId: string): Promise<number> {
    await this.ensureOwnerBinding(ownerId);
    let inserted = 0;
    for (const fixture of ADVERSARIAL_CORPUS) {
      const row = corpusFixtureToGoldenRow(fixture);
      const result = await this.db
        .insert(goldenSetMessage)
        .values({
          ownerAuthUserId: ownerId,
          fixtureId: fixture.id,
          // Fixtures have no live Gmail id (schema: nullable for fixtures).
          sourceGmailMessageId: null,
          fromAddress: row.from,
          subject: row.subject,
          bodyText: row.bodyText,
          ownerLabel: row.ownerLabel,
          partition: row.partition,
        })
        .onConflictDoNothing({
          target: [goldenSetMessage.ownerAuthUserId, goldenSetMessage.fixtureId],
        })
        .returning({ id: goldenSetMessage.id });
      if (result.length > 0) inserted += 1;
    }
    return inserted;
  }

  async listHoldout(ownerId: string): Promise<readonly GoldenSetRow[]> {
    const rows = await this.db
      .select({
        fixtureId: goldenSetMessage.fixtureId,
        fromAddress: goldenSetMessage.fromAddress,
        subject: goldenSetMessage.subject,
        bodyText: goldenSetMessage.bodyText,
        ownerLabel: goldenSetMessage.ownerLabel,
        partition: goldenSetMessage.partition,
      })
      .from(goldenSetMessage)
      .where(
        and(
          eq(goldenSetMessage.ownerAuthUserId, ownerId),
          eq(goldenSetMessage.partition, "holdout"),
        ),
      );
    return rows.map((row) => ({
      id: row.fixtureId ?? undefined,
      from: row.fromAddress,
      subject: row.subject,
      bodyText: row.bodyText,
      ownerLabel: row.ownerLabel as GoldenSetRow["ownerLabel"],
      partition: row.partition,
    }));
  }

  /**
   * Seed corpus into Golden Set if needed, score Candidate terms over Holdout,
   * persist an Eval Run, and return metrics.
   */
  async run(
    ownerId: string,
    candidateTerms: ClassificationTerms,
    options: Readonly<{ tags?: Record<string, unknown>; bounds?: SyncBounds }> = {},
  ): Promise<MatchingEvalRunResult> {
    await this.ensureCorpusGoldenSet(ownerId);
    const holdout = await this.listHoldout(ownerId);
    if (holdout.length === 0) {
      throw new Error("Golden Set Holdout is empty after corpus seed");
    }
    const metrics = runMatchingEval(holdout, candidateTerms, { holdoutOnly: false });
    const id = crypto.randomUUID();
    const candidate: MatchingEvalCandidate = {
      terms: {
        priority: [...candidateTerms.priority],
        review: [...candidateTerms.review],
        new: [...candidateTerms.new],
      },
      ...(options.bounds ? { bounds: options.bounds } : {}),
    };
    await this.db.insert(evalRun).values({
      id,
      ownerAuthUserId: ownerId,
      type: "matching",
      candidate,
      metrics,
      tags: options.tags ?? {},
      finishedAt: new Date(),
    });
    return { id, metrics, candidate };
  }
}
