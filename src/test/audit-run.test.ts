import { describe, expect, mock, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { syncLease } from "../../db/schema";
import type { Database } from "../server/db";
import {
  DEFAULT_AUDIT_CONCURRENCY,
  runAuditBatch,
} from "../server/gmail/audit-batch";
import { judgeMessage } from "../server/gmail/judge";
import { assembleJudgePrompt, selectExemplarsByCategory } from "../server/gmail/judge-prompt";

mock.module("server-only", () => ({}));

const { AuditRunService } = await import("../server/gmail/audit-run");

describe("shadow audit guarantees", () => {
  test("audit batch never needs a Gmail provider — MockLanguageModel is enough", async () => {
    let modelCalls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        modelCalls += 1;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              agrees_with_filing: false,
              recommended_category: "archive",
              rationale: "Blocked sender; leave in archive",
            }),
          }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });

    const prompt = assembleJudgePrompt({
      categoryIntent: {
        priority: "urgent work",
        review: "needs reply",
        new: "new lead",
        archive: "noise",
      },
      message: {
        from: "spam@x",
        subject: "buy",
        bodyText: "click",
        deterministicOutcome: "blocked",
      },
      exemplars: selectExemplarsByCategory([]),
    });
    expect(prompt.user).toContain("deterministic_outcome: blocked");

    const verdicts = await runAuditBatch({
      messages: [
        {
          gmailMessageId: "m1",
          outcome: "blocked",
          from: "spam@x",
          subject: "buy",
          bodyText: "click",
        },
        {
          gmailMessageId: "prot",
          outcome: "protected",
          from: "vip@x",
          subject: "starred",
          bodyText: "keep",
        },
      ],
      concurrency: DEFAULT_AUDIT_CONCURRENCY,
      judge: async (message) =>
        judgeMessage({
          model,
          system: prompt.system,
          user: assembleJudgePrompt({
            categoryIntent: {
              priority: "urgent work",
              review: "needs reply",
              new: "new lead",
              archive: "noise",
            },
            message: {
              from: message.from,
              subject: message.subject,
              bodyText: message.bodyText,
              deterministicOutcome: message.outcome as "blocked",
            },
            exemplars: selectExemplarsByCategory([]),
          }).user,
          tags: { model: "mock", provider: "mock", promptVersion: "pv-test" },
        }),
    });

    expect(modelCalls).toBe(1);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.recommendedCategory).toBe("archive");
    expect(verdicts[0]?.malformed).toBe(false);
  });

  test("lease acquire refuses when an unexpired sync lease is held", async () => {
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  orderBy() {
                    return {
                      limit: async () => [{ categoryIntent: {
                        priority: "p", review: "r", new: "n", archive: "a",
                      } }],
                    };
                  },
                  limit: async () => [{ id: "sync-1", status: "completed" }],
                };
              },
            };
          },
        };
      },
      insert(table: unknown) {
        if (table === syncLease) {
          return {
            values() {
              return {
                onConflictDoUpdate() {
                  return {
                    returning: async () => [],
                  };
                },
              };
            },
          };
        }
        return {
          values() {
            return {
              onConflictDoNothing: async () => undefined,
            };
          },
        };
      },
      delete() {
        return { where: async () => undefined };
      },
      update() {
        return {
          set() {
            return { where: async () => undefined };
          },
        };
      },
    } as unknown as Database;

    const service = new AuditRunService(db, {
      resolveModelConfig: () => ({
        provider: "mock",
        modelName: "mock",
        baseUrl: "http://localhost",
        apiKey: "test",
      }),
      resolveEncryptionKey: () => "key",
      createModel: () => {
        throw new Error("model should not be created when lease fails");
      },
    });

    await expect(service.start("owner", { syncRunId: "sync-1" })).rejects.toThrow(
      "Synchronization already running",
    );
  });
});
