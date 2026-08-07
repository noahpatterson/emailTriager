/**
 * Judge Eval service: score a candidate judge config over Golden Set Holdout.
 * Tags every Eval Run with model, provider, and prompt version (R-7).
 */
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import {
  evalRun,
  goldenSetMessage,
  promptVersion,
  triageConfig,
} from "@/db/schema";
import {
  asCategoryIntent,
  asTerms,
  hasCompleteCategoryIntent,
  type CategoryIntent,
} from "@/src/server/config/triage-validate";
import { database, type Database } from "@/src/server/db";
import {
  classifyWithReason,
  type ClassificationTerms,
} from "@/src/server/gmail/classify";
import type { Category } from "@/src/server/gmail/corpus";
import {
  DEFAULT_AUDIT_CONCURRENCY,
  runAuditBatch,
  type AuditBatchMessage,
} from "@/src/server/gmail/audit-batch";
import {
  judgeMessage,
} from "@/src/server/gmail/judge";
import {
  assembleJudgePrompt,
  judgeSystemPromptFor,
  selectExemplarsByCategory,
  type ExemplarSnippet,
} from "@/src/server/gmail/judge-prompt";
import {
  runJudgeEval,
  type JudgeEvalMetrics,
  type JudgeEvalTrial,
} from "@/src/server/gmail/judge-eval";
import { MatchingEvalService } from "@/src/server/gmail/matching-eval-service";
import {
  createJudgeModel,
  getModelConfig,
  type ModelRuntimeConfig,
} from "@/src/server/gmail/model-config";
import { promptVersionIdFor } from "@/src/server/gmail/prompt-version";
import type { ParsedMessage } from "@/src/server/gmail/message";
import { ensureOwnerBinding as writeOwnerBinding } from "@/src/server/owner-binding";

export class JudgeEvalClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JudgeEvalClientError";
  }
}

export type JudgeEvalCandidate = Readonly<{
  model: string;
  provider: string;
  promptVersion: string;
}>;

export type JudgeEvalRunResult = Readonly<{
  id: string;
  metrics: JudgeEvalMetrics;
  candidate: JudgeEvalCandidate;
  tags: Readonly<{
    model: string;
    provider: string;
    promptVersion: string;
  }>;
}>;

export type JudgeEvalServiceDeps = Readonly<{
  resolveModelConfig?: () => ModelRuntimeConfig;
  createModel?: (config: ModelRuntimeConfig) => LanguageModel;
  matchingEval?: MatchingEvalService;
}>;

function parsedFromHoldout(row: Readonly<{
  id: string;
  from: string;
  subject: string;
  bodyText: string;
}>): ParsedMessage {
  return {
    id: row.id,
    threadId: row.id,
    internalDate: null,
    labelIds: [],
    from: row.from,
    replyTo: "",
    subject: row.subject,
    bodyText: row.bodyText,
  };
}

export class JudgeEvalService {
  constructor(
    private readonly db: Database = database(),
    private readonly deps: JudgeEvalServiceDeps = {},
  ) {}

  async ensureOwnerBinding(ownerId: string): Promise<void> {
    await writeOwnerBinding(this.db, ownerId);
  }

  /**
   * Seed corpus if needed, judge each Holdout row, persist Eval Run type `judge`.
   */
  async run(
    ownerId: string,
    options: Readonly<{
      concurrency?: number;
      terms?: ClassificationTerms;
      categoryIntent?: CategoryIntent;
    }> = {},
  ): Promise<JudgeEvalRunResult> {
    await this.ensureOwnerBinding(ownerId);
    const matching = this.deps.matchingEval ?? new MatchingEvalService(this.db);
    await matching.ensureCorpusGoldenSet(ownerId);

    const [config] = await this.db
      .select({
        terms: triageConfig.terms,
        categoryIntent: triageConfig.categoryIntent,
        senderWhitelist: triageConfig.senderWhitelist,
        senderBlocklist: triageConfig.senderBlocklist,
      })
      .from(triageConfig)
      .where(eq(triageConfig.ownerAuthUserId, ownerId))
      .orderBy(desc(triageConfig.version))
      .limit(1);

    const categoryIntent = options.categoryIntent
      ?? (config ? asCategoryIntent(config.categoryIntent) : null);
    if (!categoryIntent || !hasCompleteCategoryIntent(categoryIntent)) {
      throw new JudgeEvalClientError(
        "Category intent is required for every category before running judge eval",
      );
    }

    const terms = options.terms
      ?? (config ? asTerms(config.terms) : null);
    if (!terms) {
      throw new JudgeEvalClientError("Sync configuration missing");
    }

    const whitelist = (config?.senderWhitelist as string[] | undefined) ?? [];
    const blocklist = (config?.senderBlocklist as string[] | undefined) ?? [];

    const holdout = await this.db
      .select({
        id: goldenSetMessage.id,
        fixtureId: goldenSetMessage.fixtureId,
        fromAddress: goldenSetMessage.fromAddress,
        subject: goldenSetMessage.subject,
        bodyText: goldenSetMessage.bodyText,
        ownerLabel: goldenSetMessage.ownerLabel,
      })
      .from(goldenSetMessage)
      .where(
        and(
          eq(goldenSetMessage.ownerAuthUserId, ownerId),
          eq(goldenSetMessage.partition, "holdout"),
        ),
      )
      .orderBy(goldenSetMessage.fixtureId, goldenSetMessage.id);

    if (holdout.length === 0) {
      throw new JudgeEvalClientError("Golden Set Holdout is empty after corpus seed");
    }

    const exemplars = await this.loadExemplars(ownerId);
    const exemplarsByCategory = selectExemplarsByCategory(exemplars);
    const systemPromptBody = judgeSystemPromptFor(categoryIntent);
    const promptId = promptVersionIdFor(systemPromptBody);
    await this.db
      .insert(promptVersion)
      .values({ id: promptId, body: systemPromptBody })
      .onConflictDoNothing();

    const modelConfig = (this.deps.resolveModelConfig ?? getModelConfig)();
    const model = (this.deps.createModel ?? createJudgeModel)(modelConfig);
    const tags = {
      model: modelConfig.modelName,
      provider: modelConfig.provider,
      promptVersion: promptId,
    };

    const batchMessages: AuditBatchMessage[] = [];
    const ownerLabelByMessageId = new Map<string, Category>();

    for (const row of holdout) {
      const parsed = parsedFromHoldout({
        id: row.fixtureId ?? `golden-${row.id}`,
        from: row.fromAddress,
        subject: row.subject,
        bodyText: row.bodyText,
      });
      const { outcome } = classifyWithReason(parsed, terms, whitelist, blocklist);
      if (outcome === "protected") continue;
      batchMessages.push({
        gmailMessageId: parsed.id,
        outcome,
        from: row.fromAddress,
        subject: row.subject,
        bodyText: row.bodyText,
      });
      ownerLabelByMessageId.set(parsed.id, row.ownerLabel as Category);
    }

    if (batchMessages.length === 0) {
      throw new JudgeEvalClientError("No Holdout messages eligible for judge eval");
    }

    const verdicts = await runAuditBatch({
      messages: batchMessages,
      concurrency: options.concurrency ?? DEFAULT_AUDIT_CONCURRENCY,
      judge: async (message) => {
        const prompt = assembleJudgePrompt({
          categoryIntent,
          message: {
            from: message.from,
            subject: message.subject,
            bodyText: message.bodyText,
            deterministicOutcome: message.outcome,
          },
          exemplars: exemplarsByCategory,
        });
        return judgeMessage({
          model,
          system: prompt.system,
          user: prompt.user,
          tags,
        });
      },
    });

    const trials: JudgeEvalTrial[] = [];
    for (const result of verdicts) {
      const ownerLabel = ownerLabelByMessageId.get(result.gmailMessageId);
      if (!ownerLabel) continue;
      trials.push({
        ownerLabel,
        recommendedCategory: result.recommendedCategory,
        agreesWithFiling: result.agreesWithFiling,
        malformed: result.malformed,
      });
    }

    const metrics = runJudgeEval(trials);
    const candidate: JudgeEvalCandidate = { ...tags };
    const id = crypto.randomUUID();
    await this.db.insert(evalRun).values({
      id,
      ownerAuthUserId: ownerId,
      type: "judge",
      candidate,
      metrics,
      tags,
      finishedAt: new Date(),
    });

    return { id, metrics, candidate, tags };
  }

  private async loadExemplars(ownerId: string): Promise<readonly ExemplarSnippet[]> {
    const rows = await this.db
      .select({
        fixtureId: goldenSetMessage.fixtureId,
        fromAddress: goldenSetMessage.fromAddress,
        subject: goldenSetMessage.subject,
        bodyText: goldenSetMessage.bodyText,
        ownerLabel: goldenSetMessage.ownerLabel,
      })
      .from(goldenSetMessage)
      .where(
        and(
          eq(goldenSetMessage.ownerAuthUserId, ownerId),
          eq(goldenSetMessage.partition, "exemplar"),
        ),
      )
      .orderBy(goldenSetMessage.fixtureId, goldenSetMessage.id);
    return rows.map((row) => ({
      id: row.fixtureId ?? undefined,
      from: row.fromAddress,
      subject: row.subject,
      bodyText: row.bodyText,
      ownerLabel: row.ownerLabel as Category,
    }));
  }
}
