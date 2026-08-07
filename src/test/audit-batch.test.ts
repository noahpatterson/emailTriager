import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import {
  DEFAULT_AUDIT_CONCURRENCY,
  runAuditBatch,
  type AuditBatchMessage,
  type AuditBatchVerdict,
} from "../server/gmail/audit-batch";
import type { JudgeVerdictResult } from "../server/gmail/judge";

function okVerdict(category: "priority" | "review" | "new" | "archive"): JudgeVerdictResult {
  return {
    agreesWithFiling: true,
    recommendedCategory: category,
    rationale: "ok",
    malformed: false,
    model: "mock",
    provider: "mock",
    promptVersion: "pv-1",
  };
}

describe("runAuditBatch", () => {
  test("skips protected messages with no verdict row", async () => {
    const messages: AuditBatchMessage[] = [
      { gmailMessageId: "p1", outcome: "protected", from: "a@x", subject: "s", bodyText: "b" },
      { gmailMessageId: "m1", outcome: "priority", from: "a@x", subject: "s", bodyText: "b" },
    ];
    const calls: string[] = [];
    const verdicts = await runAuditBatch({
      messages,
      concurrency: 2,
      judge: async (message) => {
        calls.push(message.gmailMessageId);
        return okVerdict("priority");
      },
    });
    expect(calls).toEqual(["m1"]);
    expect(verdicts.map((v) => v.gmailMessageId)).toEqual(["m1"]);
  });

  test("issues one model call per non-protected message", async () => {
    const messages: AuditBatchMessage[] = [
      { gmailMessageId: "m1", outcome: "blocked", from: "a@x", subject: "s", bodyText: "b" },
      { gmailMessageId: "m2", outcome: "unmatched", from: "a@x", subject: "s", bodyText: "b" },
      { gmailMessageId: "m3", outcome: "review", from: "a@x", subject: "s", bodyText: "b" },
    ];
    let calls = 0;
    await runAuditBatch({
      messages,
      concurrency: DEFAULT_AUDIT_CONCURRENCY,
      judge: async () => {
        calls += 1;
        return okVerdict("archive");
      },
    });
    expect(calls).toBe(3);
  });

  test("respects concurrency while preserving completion for all messages", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const messages: AuditBatchMessage[] = Array.from({ length: 8 }, (_, i) => ({
      gmailMessageId: `m${i}`,
      outcome: "new" as const,
      from: "a@x",
      subject: "s",
      bodyText: "b",
    }));
    const verdicts = await runAuditBatch({
      messages,
      concurrency: 3,
      judge: async (message) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { ...okVerdict("new"), rationale: message.gmailMessageId };
      },
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(verdicts).toHaveLength(8);
    expect(new Set(verdicts.map((v: AuditBatchVerdict) => v.gmailMessageId)).size).toBe(8);
  });

  test("continues after a malformed verdict", async () => {
    const messages: AuditBatchMessage[] = [
      { gmailMessageId: "bad", outcome: "priority", from: "a@x", subject: "s", bodyText: "b" },
      { gmailMessageId: "good", outcome: "priority", from: "a@x", subject: "s", bodyText: "b" },
    ];
    const verdicts = await runAuditBatch({
      messages,
      concurrency: 1,
      judge: async (message) => {
        if (message.gmailMessageId === "bad") {
          return {
            agreesWithFiling: null,
            recommendedCategory: null,
            rationale: null,
            malformed: true,
            model: "mock",
            provider: "mock",
            promptVersion: "pv-1",
          };
        }
        return okVerdict("priority");
      },
    });
    expect(verdicts.find((v) => v.gmailMessageId === "bad")?.malformed).toBe(true);
    expect(verdicts.find((v) => v.gmailMessageId === "good")?.malformed).toBe(false);
  });

  test("drains active workers before propagating a judge failure", async () => {
    let finishedAfterStop = 0;
    const messages: AuditBatchMessage[] = [
      { gmailMessageId: "m0", outcome: "priority", from: "a@x", subject: "s", bodyText: "b" },
      { gmailMessageId: "m1", outcome: "priority", from: "a@x", subject: "s", bodyText: "b" },
      { gmailMessageId: "m2", outcome: "priority", from: "a@x", subject: "s", bodyText: "b" },
      { gmailMessageId: "m3", outcome: "priority", from: "a@x", subject: "s", bodyText: "b" },
    ];
    await expect(runAuditBatch({
      messages,
      concurrency: 2,
      judge: async (message) => {
        if (message.gmailMessageId === "m0") {
          await new Promise((resolve) => setTimeout(resolve, 20));
          finishedAfterStop += 1;
          return okVerdict("priority");
        }
        if (message.gmailMessageId === "m1") {
          throw new Error("boom");
        }
        finishedAfterStop += 1;
        return okVerdict("priority");
      },
    })).rejects.toThrow("boom");
    expect(finishedAfterStop).toBeGreaterThanOrEqual(1);
  });

  // Keep MockLanguageModel import live so the suite documents the AC seam.
  test("MockLanguageModel is available for judge integration", () => {
    expect(typeof MockLanguageModelV4).toBe("function");
  });
});
