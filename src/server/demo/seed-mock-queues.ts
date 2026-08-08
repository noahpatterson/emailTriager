/**
 * Seed a finished mock audit so demo /review and /demotion show the real queue UIs
 * without calling a model: 5 disagreement verdicts + 1 pending archive demotion.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  auditRun,
  messageProcessing,
  messageSnapshot,
  pendingDemotion,
  promptVersion,
  syncRun,
  verdict,
} from "@/db/schema";
import type { PgDatabase } from "@/src/server/db";
import { ADVERSARIAL_CORPUS, type Category, type CorpusFixture } from "@/src/server/gmail/corpus";
import { encryptMessageSnapshotPayload } from "@/src/server/gmail/message-snapshot";
import {
  JUDGE_PROMPT_VERSION_BODY,
  promptVersionIdFor,
} from "@/src/server/gmail/prompt-version";

export const DEMO_MOCK_MODEL_PROVIDER = "mock";
export const DEMO_MOCK_MODEL_NAME = "demo-fixture-judge";

type ClassificationOutcomeRow =
  | "priority"
  | "review"
  | "new"
  | "unmatched"
  | "blocked"
  | "protected"
  | "failed";

type MockQueueSeed = Readonly<{
  fixtureId: string;
  deterministicOutcome: ClassificationOutcomeRow;
  recommendedCategory: Category;
  rationale: string;
  forDemotion: boolean;
}>;

/** Five disagreements for the review queue (stratified mode keeps all). */
const REVIEW_SEEDS: readonly Omit<MockQueueSeed, "forDemotion">[] = [
  {
    fixtureId: "fix-076",
    deterministicOutcome: "priority",
    recommendedCategory: "archive",
    rationale: "Marketing borrowed “urgent”; true category is archive.",
  },
  {
    fixtureId: "fix-084",
    deterministicOutcome: "unmatched",
    recommendedCategory: "priority",
    rationale: "Whole-token miss on “urgently”; owner label is priority.",
  },
  {
    fixtureId: "fix-090",
    deterministicOutcome: "priority",
    recommendedCategory: "review",
    rationale: "First-match “escalate” beat review terms; should be review.",
  },
  {
    fixtureId: "fix-094",
    deterministicOutcome: "priority",
    recommendedCategory: "archive",
    rationale: "Late-body priority term in noise alert; archive is correct.",
  },
  {
    fixtureId: "fix-098",
    deterministicOutcome: "new",
    recommendedCategory: "archive",
    rationale: "Cold outreach used new-inquiry terms; archive is correct.",
  },
];

/** One archive demotion; agreesWithFiling null so it stays out of the review pending set. */
const DEMOTION_SEED: Omit<MockQueueSeed, "forDemotion"> = {
  fixtureId: "fix-077",
  deterministicOutcome: "priority",
  recommendedCategory: "archive",
  rationale: "Promo used “urgent”; demote to archive after owner confirms.",
};

export const DEMO_MOCK_QUEUE_SEEDS: readonly MockQueueSeed[] = [
  ...REVIEW_SEEDS.map((seed) => ({ ...seed, forDemotion: false as const })),
  { ...DEMOTION_SEED, forDemotion: true as const },
];

export const DEMO_MOCK_REVIEW_COUNT = REVIEW_SEEDS.length;
export const DEMO_MOCK_DEMOTION_COUNT = 1;

function requireFixture(id: string): CorpusFixture {
  const fixture = ADVERSARIAL_CORPUS.find((row) => row.id === id);
  if (!fixture) throw new Error(`Demo mock queue missing corpus fixture ${id}`);
  return fixture;
}

/** SQL fragment: sync runs that exist only to back seeded demo mock audits. */
export function sqlNotDemoMockSeedSync() {
  return sql`NOT EXISTS (
    SELECT 1 FROM audit_run ar
    WHERE ar.sync_run_id = ${syncRun.id}
      AND ar.model_provider = ${DEMO_MOCK_MODEL_PROVIDER}
      AND ar.model_name = ${DEMO_MOCK_MODEL_NAME}
  )`;
}

/** Insert mock sync + audit + verdicts under an open owner transaction (RLS already set). */
export async function seedDemoMockQueues(
  db: PgDatabase,
  ownerId: string,
  encryptionKey: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: auditRun.id })
    .from(auditRun)
    .where(eq(auditRun.ownerAuthUserId, ownerId))
    .limit(1);
  if (existing) return;

  const promptId = promptVersionIdFor(JUDGE_PROMPT_VERSION_BODY);
  await db
    .insert(promptVersion)
    .values({ id: promptId, body: JUDGE_PROMPT_VERSION_BODY })
    .onConflictDoNothing();

  const syncRunId = randomUUID();
  const auditRunId = randomUUID();
  const finishedAt = new Date();
  const resolved = DEMO_MOCK_QUEUE_SEEDS.map((seed) => ({
    seed,
    fixture: requireFixture(seed.fixtureId),
  }));

  await db.insert(syncRun).values({
    id: syncRunId,
    ownerAuthUserId: ownerId,
    configVersion: 1,
    status: "completed",
    trial: false,
    startedAt: finishedAt,
    finishedAt,
  });

  for (const { seed, fixture } of resolved) {
    await db.insert(messageProcessing).values({
      runId: syncRunId,
      gmailMessageId: fixture.id,
      gmailThreadId: fixture.threadId,
      internalDate: finishedAt,
      senderAddress: fixture.from,
      subject: fixture.subject,
      outcome: seed.deterministicOutcome,
      outcomeReason: `demo mock · ${seed.deterministicOutcome}`,
      processedAt: finishedAt,
    });
    await db.insert(messageSnapshot).values({
      ownerAuthUserId: ownerId,
      runId: syncRunId,
      gmailMessageId: fixture.id,
      encryptedPayload: encryptMessageSnapshotPayload(
        {
          subject: fixture.subject,
          from: fixture.from,
          replyTo: "",
          bodyText: fixture.body,
        },
        encryptionKey,
      ),
      keyVersion: 1,
    });
  }

  await db.insert(auditRun).values({
    id: auditRunId,
    ownerAuthUserId: ownerId,
    syncRunId,
    status: "completed",
    promptVersionId: promptId,
    modelProvider: DEMO_MOCK_MODEL_PROVIDER,
    modelName: DEMO_MOCK_MODEL_NAME,
    processedCount: resolved.length,
    totalEligible: resolved.length,
    startedAt: finishedAt,
    finishedAt,
  });

  let demotionVerdictId: number | null = null;
  for (const { seed, fixture } of resolved) {
    const [row] = await db
      .insert(verdict)
      .values({
        auditRunId,
        gmailMessageId: fixture.id,
        agreesWithFiling: seed.forDemotion ? null : false,
        recommendedCategory: seed.recommendedCategory,
        rationale: seed.rationale,
        malformed: false,
        modelName: DEMO_MOCK_MODEL_NAME,
        modelProvider: DEMO_MOCK_MODEL_PROVIDER,
        promptVersionId: promptId,
      })
      .returning({ id: verdict.id });
    if (seed.forDemotion) {
      demotionVerdictId = row?.id ?? null;
    }
  }

  if (demotionVerdictId == null) {
    throw new Error("Demo mock demotion verdict was not inserted");
  }

  await db.insert(pendingDemotion).values({
    ownerAuthUserId: ownerId,
    gmailMessageId: DEMOTION_SEED.fixtureId,
    verdictId: demotionVerdictId,
  });
}
