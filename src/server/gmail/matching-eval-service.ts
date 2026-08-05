import "server-only";
import { and, eq } from "drizzle-orm";
import { evalRun, goldenSetMessage, ownerBinding } from "@/db/schema";
import { database, type Database } from "@/src/server/db";
import type { ClassificationTerms } from "@/src/server/gmail/classify";
import { ADVERSARIAL_CORPUS } from "@/src/server/gmail/corpus";
import {
  goldenRowsFromCorpus,
  runMatchingEval,
  type GoldenSetRow,
  type MatchingEvalMetrics,
} from "@/src/server/gmail/matching-eval";

export type MatchingEvalRunResult = Readonly<{
  id: string;
  metrics: MatchingEvalMetrics;
  candidate: ClassificationTerms;
}>;

export class MatchingEvalService {
  constructor(private readonly db: Database = database()) {}

  async ensureOwnerBinding(ownerId: string): Promise<void> {
    const [existing] = await this.db
      .select({ authUserId: ownerBinding.authUserId })
      .from(ownerBinding)
      .limit(1);
    if (!existing) {
      await this.db.insert(ownerBinding).values({ authUserId: ownerId });
      return;
    }
    if (existing.authUserId !== ownerId) throw new Error("Owner binding mismatch");
  }

  /** Idempotently seed adversarial corpus fixtures into the owner's Golden Set. */
  async ensureCorpusGoldenSet(ownerId: string): Promise<number> {
    await this.ensureOwnerBinding(ownerId);
    let inserted = 0;
    for (const fixture of ADVERSARIAL_CORPUS) {
      const result = await this.db
        .insert(goldenSetMessage)
        .values({
          ownerAuthUserId: ownerId,
          fixtureId: fixture.id,
          sourceGmailMessageId: fixture.id,
          fromAddress: fixture.from,
          subject: fixture.subject,
          bodyText: fixture.body,
          ownerLabel: fixture.ownerLabel,
          partition: fixture.partition,
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
    options: Readonly<{ tags?: Record<string, unknown> }> = {},
  ): Promise<MatchingEvalRunResult> {
    await this.ensureCorpusGoldenSet(ownerId);
    let holdout = await this.listHoldout(ownerId);
    if (holdout.length === 0) {
      holdout = goldenRowsFromCorpus().filter((row) => row.partition === "holdout");
    }
    const metrics = runMatchingEval(holdout, candidateTerms, { holdoutOnly: false });
    const id = crypto.randomUUID();
    const candidate = {
      priority: [...candidateTerms.priority],
      review: [...candidateTerms.review],
      new: [...candidateTerms.new],
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
