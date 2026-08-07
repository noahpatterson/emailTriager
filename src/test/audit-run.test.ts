import { describe, expect, mock, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { syncLease } from "../../db/schema";
import type { Database } from "../server/db";
import {
  DEFAULT_AUDIT_CONCURRENCY,
  runAuditBatch,
} from "../server/gmail/audit-batch";
import { buildAuditCandidates } from "../server/gmail/audit-candidates";
import { judgeMessage } from "../server/gmail/judge";
import { assembleJudgePrompt, selectExemplarsByCategory } from "../server/gmail/judge-prompt";
import { encryptMessageSnapshotPayload } from "../server/gmail/message-snapshot";

mock.module("server-only", () => ({}));

const { AuditAlreadyRunningError, AuditLeaseLostError, AuditRunService } = await import(
  "../server/gmail/audit-run"
);

const SNAP_KEY = "test-encryption-key-for-audit-run";

describe("shadow audit guarantees", () => {
  test("audit path skips protected via candidates — MockLanguageModel is enough", async () => {
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

    const { candidates } = buildAuditCandidates({
      snapshots: [
        {
          gmailMessageId: "m1",
          encryptedPayload: encryptMessageSnapshotPayload(
            { subject: "buy", from: "spam@x", replyTo: "", bodyText: "click" },
            SNAP_KEY,
          ),
          keyVersion: 1,
        },
        {
          gmailMessageId: "prot",
          encryptedPayload: encryptMessageSnapshotPayload(
            { subject: "starred", from: "vip@x", replyTo: "", bodyText: "keep" },
            SNAP_KEY,
          ),
          keyVersion: 1,
        },
      ],
      outcomes: [
        { gmailMessageId: "m1", outcome: "blocked" },
        { gmailMessageId: "prot", outcome: "protected" },
      ],
      encryptionKey: SNAP_KEY,
    });
    expect(candidates.map((c) => c.gmailMessageId)).toEqual(["m1"]);

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
    expect(prompt.user).toContain("<<<MESSAGE");

    const verdicts = await runAuditBatch({
      messages: candidates,
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
              deterministicOutcome: message.outcome,
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
      createModel: () => {
        throw new Error("model should not be created when lease fails");
      },
    });

    await expect(service.start("owner", { syncRunId: "sync-1" })).rejects.toBeInstanceOf(
      AuditAlreadyRunningError,
    );
  });

  test("lease renew failure mid-batch yields lease_lost without throwing", async () => {
    const encryptedPayload = encryptMessageSnapshotPayload(
      { subject: "s", from: "a@x", replyTo: "", bodyText: "body" },
      SNAP_KEY,
    );
    const fake = makeLeaseLostFakeDb(encryptedPayload);
    const service = new AuditRunService(fake.db, {
      resolveEncryptionKey: () => SNAP_KEY,
      resolveModelConfig: () => ({
        provider: "mock",
        modelName: "mock",
        baseUrl: "http://localhost",
        apiKey: "k",
      }),
      createModel: () => new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{
            type: "text",
            text: JSON.stringify({
              agrees_with_filing: true,
              recommended_category: "priority",
              rationale: "ok",
            }),
          }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        }),
      }) as never,
    });

    const result = await service.start("owner", { syncRunId: "sync-1", maxMessages: 1 });
    expect(fake.leaseRenewAttempted).toBe(true);
    expect(result.status).toBe("partial_failure");
    expect(result.errorCode).toBe("lease_lost");
  });

  test("AuditLeaseLostError is a stable typed code", () => {
    const err = new AuditLeaseLostError();
    expect(err.code).toBe("lease_lost");
    expect(err).toBeInstanceOf(Error);
  });
});

/**
 * Fake drizzle chain for AuditRunService.start until lease renew fails.
 * select order: config → sync → resume checkpoint → snapshots → outcomes → judged → exemplars
 * (+ post-failure judged re-query).
 */
function makeLeaseLostFakeDb(encryptedPayload: string) {
  let leaseRenewAttempted = false;
  let selectCount = 0;

  const thenable = <T>(value: T) => ({
    then(resolve: (value: T) => unknown) {
      return Promise.resolve(resolve(value));
    },
  });

  const db = {
    select() {
      selectCount += 1;
      const n = selectCount;
      return {
        from() {
          return {
            where() {
              return {
                orderBy() {
                  return {
                    limit: async () => {
                      if (n === 1) {
                        return [{ categoryIntent: {
                          priority: "p", review: "r", new: "n", archive: "a",
                        } }];
                      }
                      if (n === 3) return [];
                      return [];
                    },
                    ...thenable([]),
                  };
                },
                limit: async () => {
                  if (n === 2) return [{ id: "sync-1", status: "completed" }];
                  return [];
                },
                ...thenable(
                  n === 4
                    ? [{ gmailMessageId: "m1", encryptedPayload, keyVersion: 1 }]
                    : n === 5
                      ? [{ gmailMessageId: "m1", outcome: "priority" }]
                      : [],
                ),
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
                  returning: async () => [{ fenceToken: 1 }],
                };
              },
            };
          },
        };
      }
      return {
        values() {
          return {
            onConflictDoNothing() {
              return Promise.resolve(undefined);
            },
            returning() {
              return Promise.resolve([{ gmailMessageId: "m1" }]);
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set() {
          return {
            where() {
              return {
                returning: async () => {
                  if (table === syncLease) {
                    leaseRenewAttempted = true;
                    return [];
                  }
                  return [];
                },
              };
            },
          };
        },
      };
    },
    delete() {
      return { where: async () => undefined };
    },
  } as unknown as Database;

  return {
    db,
    get leaseRenewAttempted() {
      return leaseRenewAttempted;
    },
  };
}
