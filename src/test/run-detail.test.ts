import { describe, expect, test } from "bun:test";
import { buildRunResultRows, ownedRunOrNull } from "../server/gmail/run-detail-map";
import { gmailMessageUrl } from "../../app/run-results";

const labels = {
  sourceLabelId: "Label_source",
  priorityLabelId: "Label_priority",
  reviewLabelId: "Label_review",
  contestLabelId: "Label_contest",
  contestArchiveLabelId: "Label_archive",
};

const catalog = [
  { id: "Label_priority", name: "Triage/Priority" },
  { id: "Label_review", name: "Triage/Review" },
  { id: "Label_contest", name: "Triage/New contest" },
  { id: "Label_archive", name: "Triage/Contest archive" },
] as const;

describe("run detail review mapping", () => {
  test("maps outcomes to destination labels from the run config version", () => {
    const rows = buildRunResultRows([
      { gmailMessageId: "m1", gmailThreadId: "t1", subject: "Winner!", senderAddress: "a@example.com", outcome: "priority" },
      { gmailMessageId: "m2", gmailThreadId: "t2", subject: "Please review", senderAddress: "b@example.com", outcome: "review" },
      { gmailMessageId: "m3", gmailThreadId: "t3", subject: "Enter now", senderAddress: "c@example.com", outcome: "new_contest" },
      { gmailMessageId: "m4", gmailThreadId: "t4", subject: "Hello", senderAddress: "d@example.com", outcome: "unmatched" },
      { gmailMessageId: "m5", gmailThreadId: "t5", subject: "VIP", senderAddress: "e@example.com", outcome: "protected" },
      { gmailMessageId: "m6", gmailThreadId: "t6", subject: "Blocked", senderAddress: "f@example.com", outcome: "blocked" },
      { gmailMessageId: "m7", gmailThreadId: null, subject: null, senderAddress: null, outcome: "failed" },
    ], labels);

    expect(rows).toEqual([
      { gmailMessageId: "m1", gmailThreadId: "t1", subject: "Winner!", senderAddress: "a@example.com", outcome: "priority", proposedLabelId: "Label_priority" },
      { gmailMessageId: "m2", gmailThreadId: "t2", subject: "Please review", senderAddress: "b@example.com", outcome: "review", proposedLabelId: "Label_review" },
      { gmailMessageId: "m3", gmailThreadId: "t3", subject: "Enter now", senderAddress: "c@example.com", outcome: "new_contest", proposedLabelId: "Label_contest" },
      { gmailMessageId: "m4", gmailThreadId: "t4", subject: "Hello", senderAddress: "d@example.com", outcome: "unmatched", proposedLabelId: "Label_archive" },
      { gmailMessageId: "m5", gmailThreadId: "t5", subject: "VIP", senderAddress: "e@example.com", outcome: "protected", proposedLabelId: null },
      { gmailMessageId: "m6", gmailThreadId: "t6", subject: "Blocked", senderAddress: "f@example.com", outcome: "blocked", proposedLabelId: "Label_archive" },
      { gmailMessageId: "m7", gmailThreadId: null, subject: null, senderAddress: null, outcome: "failed", proposedLabelId: null },
    ]);
  });

  test("prefers Gmail display names when a catalog is available", () => {
    const [row] = buildRunResultRows([
      { gmailMessageId: "m1", gmailThreadId: "t1", subject: "Winner!", senderAddress: "a@example.com", outcome: "priority" },
    ], labels, catalog);
    expect(row?.proposedLabelId).toBe("Triage/Priority");
  });

  test("returns null destinations when the config snapshot is missing", () => {
    const [row] = buildRunResultRows([
      { gmailMessageId: "m1", gmailThreadId: "t1", subject: "Winner!", senderAddress: "a@example.com", outcome: "priority" },
    ], null);
    expect(row?.proposedLabelId).toBeNull();
    expect(row?.outcome).toBe("priority");
  });

  test("builds Gmail deep links from thread id with message id fallback", () => {
    expect(gmailMessageUrl({ gmailMessageId: "m1", gmailThreadId: "thread99" }))
      .toBe("https://mail.google.com/mail/u/0/#all/thread99");
    expect(gmailMessageUrl({ gmailMessageId: "m1", gmailThreadId: null }))
      .toBe("https://mail.google.com/mail/u/0/#all/m1");
  });
});

describe("run detail owner scoping", () => {
  test("unknown id and wrong owner yield no run", () => {
    expect(ownedRunOrNull(undefined, "owner-1")).toBeNull();
    expect(ownedRunOrNull({ ownerAuthUserId: "other" }, "owner-1")).toBeNull();
    expect(ownedRunOrNull({ ownerAuthUserId: "owner-1", id: "run-1" }, "owner-1")).toEqual({
      ownerAuthUserId: "owner-1",
      id: "run-1",
    });
  });
});
