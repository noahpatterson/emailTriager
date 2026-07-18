import { describe, expect, test } from "bun:test";
import { runMessage } from "../../app/run-status";
import type { ParsedMessage } from "../server/gmail/message";
import { DeterministicGmailFake } from "../server/gmail/fake";
import { destinationFor, listBounded, reconcileLabelMovement } from "../server/gmail/sync";

const TRIAL_BOUNDS = { maxPages: 1, maxMessagesPerPage: 10, maxTotalMessages: 10 } as const;

const labels = {
  sourceLabelId: "source",
  priorityLabelId: "priority",
  reviewLabelId: "review",
  contestLabelId: "contest",
  contestArchiveLabelId: "archive",
};

describe("trial sync bounds", () => {
  test("caps a trial batch at 10 messages and preserves resume token", async () => {
    const fake = new DeterministicGmailFake({
      first: {
        messages: Array.from({ length: 10 }, (_, index) => ({ id: `m${index + 1}`, threadId: "t" })),
        nextPageToken: "p2",
      },
      p2: {
        messages: Array.from({ length: 5 }, (_, index) => ({ id: `m${index + 11}`, threadId: "t" })),
      },
    });
    const first = await listBounded(fake, "source", TRIAL_BOUNDS);
    expect(first.messageIds).toHaveLength(10);
    expect(first.exhausted).toBe(false);
    expect(first.nextPageToken).toBe("p2");

    const second = await listBounded(fake, "source", TRIAL_BOUNDS, first.nextPageToken);
    expect(second.messageIds).toEqual(["m11", "m12", "m13", "m14", "m15"]);
    expect(second.exhausted).toBe(true);
  });

  test("maps outcomes to destination labels without applying mutations", () => {
    expect(destinationFor("priority", labels)).toBe("priority");
    expect(destinationFor("review", labels)).toBe("review");
    expect(destinationFor("new_contest", labels)).toBe("contest");
    expect(destinationFor("blocked", labels)).toBe("archive");
    expect(destinationFor("unmatched", labels)).toBe("archive");
    expect(destinationFor("protected", labels)).toBeNull();
  });

  test("live reconcile mutates labels while trial only proposes destinations", async () => {
    const message: ParsedMessage = {
      id: "m1",
      threadId: "t1",
      internalDate: null,
      labelIds: ["source"],
      from: "sender@example.com",
      replyTo: "",
      subject: "urgent",
      bodyText: "urgent",
    };
    expect(destinationFor("priority", labels)).toBe("priority");

    const liveFake = new DeterministicGmailFake({ first: { messages: [] } });
    await reconcileLabelMovement(liveFake, message, "priority", labels);
    expect(liveFake.mutations).toEqual([{
      messageId: "m1",
      addLabelIds: ["priority"],
      removeLabelIds: ["source"],
    }]);
  });
});

describe("trial run messaging", () => {
  test("explains trial dry-run outcomes without claiming labels were applied", () => {
    expect(runMessage("bounded_incomplete", true)).toContain("Trial more");
    expect(runMessage("completed", true)).toContain("No Gmail labels were changed");
    expect(runMessage("failed", true)).toContain("No Gmail labels were changed");
    expect(runMessage("bounded_incomplete", false)).not.toContain("Trial");
  });
});
