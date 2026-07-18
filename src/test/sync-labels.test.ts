import { describe, expect, test } from "bun:test";
import type { GmailProvider, LabelChange } from "../server/gmail/contracts";
import type { ParsedMessage } from "../server/gmail/message";
import { reconcileLabelMovement } from "../server/gmail/sync";

const labels = {
  sourceLabelId: "source",
  priorityLabelId: "priority",
  reviewLabelId: "review",
  contestLabelId: "contest",
  contestArchiveLabelId: "archive",
};

const message = (labelIds: readonly string[]): ParsedMessage => ({
  id: "m1",
  threadId: "t1",
  internalDate: null,
  labelIds,
  from: "sender@example.com",
  replyTo: "",
  subject: "",
  bodyText: "",
});

class ReconciliationFake implements GmailProvider {
  readonly mutations: LabelChange[] = [];
  reads = 0;
  constructor(private readonly refreshed: unknown, private failures = 0) {}
  async listLabels() {
    return [
      { id: "source", name: "Source" },
      { id: "priority", name: "Priority" },
      { id: "review", name: "Review" },
      { id: "contest", name: "Contest" },
      { id: "archive", name: "Archive" },
    ];
  }
  async listMessages() { return { messages: [] }; }
  async getMessage() {
    const value = Array.isArray(this.refreshed)
      ? this.refreshed[Math.min(this.reads, this.refreshed.length - 1)]
      : this.refreshed;
    this.reads += 1;
    return value;
  }
  async modifyLabels(change: LabelChange) {
    this.mutations.push(change);
    if (this.failures-- > 0) throw new Error("ambiguous transport result");
  }
  async trashMessage() {}
  async revoke() {}
}

describe("safe label reconciliation", () => {
  test("adds destination and removes source in one mutation", async () => {
    const fake = new ReconciliationFake({});
    await reconcileLabelMovement(fake, message(["source"]), "priority", labels);
    expect(fake.mutations).toEqual([{ messageId: "m1", addLabelIds: ["priority"], removeLabelIds: ["source"] }]);
  });

  test("protected never mutates; unmatched and blocked move to contest-archive", async () => {
    const fake = new ReconciliationFake({});
    await reconcileLabelMovement(fake, message(["source"]), "protected", labels);
    expect(fake.mutations).toEqual([]);
    await reconcileLabelMovement(fake, message(["source"]), "unmatched", labels);
    await reconcileLabelMovement(fake, message(["source"]), "blocked", labels);
    expect(fake.mutations).toEqual([
      { messageId: "m1", addLabelIds: ["archive"], removeLabelIds: ["source"] },
      { messageId: "m1", addLabelIds: ["archive"], removeLabelIds: ["source"] },
    ]);
  });

  test("starred messages never call modifyLabels even for movable outcomes", async () => {
    const fake = new ReconciliationFake({});
    await reconcileLabelMovement(fake, message(["source", "STARRED"]), "priority", labels);
    await reconcileLabelMovement(fake, message(["source", "STARRED"]), "blocked", labels);
    expect(fake.mutations).toEqual([]);
  });

  test("an ambiguous result is fetched and accepted when already converged", async () => {
    const fake = new ReconciliationFake({
      id: "m1", threadId: "t1", internalDate: "0", labelIds: ["priority"],
      payload: { headers: [{ name: "From", value: "sender@example.com" }] },
    }, 1);
    await reconcileLabelMovement(fake, message(["source"]), "priority", labels);
    expect(fake.mutations).toHaveLength(1);
  });

  test("re-reads and accepts convergence after the final ambiguous attempt", async () => {
    const fake = new ReconciliationFake([{
      id: "m1", threadId: "t1", internalDate: "0", labelIds: ["source"],
      payload: { headers: [{ name: "From", value: "sender@example.com" }] },
    }, {
      id: "m1", threadId: "t1", internalDate: "0", labelIds: ["priority"],
      payload: { headers: [{ name: "From", value: "sender@example.com" }] },
    }], 2);
    await reconcileLabelMovement(fake, message(["source"]), "priority", labels);
    expect(fake.mutations).toHaveLength(2);
    expect(fake.reads).toBe(2);
  });

  test("re-reads after the final ambiguity before reporting failure", async () => {
    const fake = new ReconciliationFake({
      id: "m1", threadId: "t1", internalDate: "0", labelIds: ["source"],
      payload: { headers: [{ name: "From", value: "sender@example.com" }] },
    }, 2);
    await expect(reconcileLabelMovement(fake, message(["source"]), "priority", labels)).rejects.toThrow("ambiguous");
    expect(fake.reads).toBe(2);
  });

  test("retries only missing source removal and never removes destination", async () => {
    const fake = new ReconciliationFake({
      id: "m1", threadId: "t1", internalDate: "0", labelIds: ["source", "priority"],
      payload: { headers: [{ name: "From", value: "sender@example.com" }] },
    }, 1);
    await reconcileLabelMovement(fake, message(["source"]), "priority", labels);
    expect(fake.mutations[1]).toEqual({ messageId: "m1", addLabelIds: [], removeLabelIds: ["source"] });
  });

  test("checks the current mutation fence immediately before every Gmail write", async () => {
    const fake = new ReconciliationFake({
      id: "m1", threadId: "t1", internalDate: "0", labelIds: ["source"],
      payload: { headers: [{ name: "From", value: "sender@example.com" }] },
    }, 1);
    let checks = 0;
    await expect(reconcileLabelMovement(
      fake,
      message(["source"]),
      "priority",
      labels,
      async () => {
        checks += 1;
        if (checks === 2) throw new Error("Synchronization lease lost");
      },
    )).rejects.toThrow("lease lost");
    expect(checks).toBe(2);
    expect(fake.mutations).toHaveLength(1);
  });
});
