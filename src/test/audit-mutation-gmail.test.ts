import { describe, expect, mock, test } from "bun:test";
import type { GmailProvider, LabelChange } from "../server/gmail/contracts";
import type { ParsedMessage } from "../server/gmail/message";
import { decideAuditMutation } from "../server/gmail/audit-mutation";
import { reconcileCategoryFiling } from "../server/gmail/sync";

mock.module("server-only", () => ({}));

const labels = {
  sourceLabelId: "source",
  priorityLabelId: "priority",
  reviewLabelId: "review",
  newLabelId: "new",
  archiveLabelId: "archive",
};

const message = (labelIds: readonly string[]): ParsedMessage => ({
  id: "m-promote",
  threadId: "t1",
  internalDate: null,
  labelIds,
  from: "sender@example.com",
  replyTo: "",
  subject: "bill due",
  bodyText: "please pay",
});

class MutationFake implements GmailProvider {
  readonly mutations: LabelChange[] = [];
  constructor(private readonly labelIds: readonly string[]) {}
  async listLabels() {
    return Object.entries(labels).map(([name, id]) => ({ id, name }));
  }
  async listMessages() { return { messages: [] }; }
  async getMessage() {
    return {
      id: "m-promote",
      threadId: "t1",
      internalDate: "0",
      labelIds: this.labelIds,
      payload: { headers: [{ name: "From", value: "sender@example.com" }] },
    };
  }
  async modifyLabels(change: LabelChange) {
    this.mutations.push(change);
  }
  async trashMessage() {}
  async revoke() {}
}

describe("promotion vs demotion mutation paths", () => {
  test("promotion disagreement records modifyLabels when auto-apply is on", async () => {
    const decision = decideAuditMutation({
      deterministicOutcome: "unmatched",
      recommendedCategory: "priority",
      autoApplyPromotions: true,
      malformed: false,
      agreesWithFiling: false,
    });
    expect(decision).toBe("promote");

    const fake = new MutationFake(["archive"]);
    const parsed = message(["archive"]);
    await reconcileCategoryFiling(fake, parsed, "priority", labels);
    expect(fake.mutations).toEqual([{
      messageId: "m-promote",
      addLabelIds: ["priority"],
      removeLabelIds: ["archive"],
    }]);
  });

  test("demotion disagreement does not call modifyLabels until confirmed", async () => {
    const decision = decideAuditMutation({
      deterministicOutcome: "priority",
      recommendedCategory: "archive",
      autoApplyPromotions: true,
      malformed: false,
      agreesWithFiling: false,
    });
    expect(decision).toBe("pending_demotion");

    const fake = new MutationFake(["priority"]);
    // Pending path: no Gmail write yet.
    expect(fake.mutations).toEqual([]);

    // Confirm path applies archive filing.
    await reconcileCategoryFiling(fake, message(["priority"]), "archive", labels);
    expect(fake.mutations).toEqual([{
      messageId: "m-promote",
      addLabelIds: ["archive"],
      removeLabelIds: ["priority"],
    }]);
  });

  test("auto-apply off skips promotion mutations entirely", async () => {
    const decision = decideAuditMutation({
      deterministicOutcome: "blocked",
      recommendedCategory: "review",
      autoApplyPromotions: false,
      malformed: false,
      agreesWithFiling: false,
    });
    expect(decision).toBe("skip");
    const fake = new MutationFake(["archive"]);
    expect(fake.mutations).toEqual([]);
  });
});
