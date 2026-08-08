import { describe, expect, test } from "bun:test";
import { encryptMessageSnapshotPayload } from "../server/gmail/message-snapshot";
import { buildAuditCandidates } from "../server/gmail/audit-candidates";

const KEY = "test-encryption-key-for-audit-candidates";
const EMPTY_TERMS = { priority: [] as string[], review: [] as string[], new: [] as string[] };

function snap(id: string, from = "a@example.com", bodyText = `body-${id}`) {
  return {
    gmailMessageId: id,
    encryptedPayload: encryptMessageSnapshotPayload(
      { subject: `subj-${id}`, from, replyTo: "", bodyText },
      KEY,
    ),
    keyVersion: 1,
  };
}

describe("buildAuditCandidates", () => {
  test("keeps priority/review/new and skips protected whitelist and blocked", () => {
    const { candidates, decryptFailures } = buildAuditCandidates({
      snapshots: [
        snap("m1", "a@example.com", "please urgent reply"),
        snap("m2"),
        snap("m3"),
      ],
      outcomes: [
        { gmailMessageId: "m1", outcome: "priority" },
        { gmailMessageId: "m2", outcome: "protected" },
        { gmailMessageId: "m3", outcome: "blocked" },
      ],
      encryptionKey: KEY,
      terms: { priority: ["urgent"], review: [], new: [] },
    });
    expect(candidates.map((c) => c.gmailMessageId)).toEqual(["m1"]);
    expect(decryptFailures).toEqual([]);
  });

  test("skips archive filings even when the body contains classification terms", () => {
    const { candidates } = buildAuditCandidates({
      snapshots: [
        snap("blocked", "spam@x", "urgent sale"),
        snap("unmatched", "noise@x", "please review this"),
        snap("hit", "a@x", "needs review please"),
      ],
      outcomes: [
        { gmailMessageId: "blocked", outcome: "blocked" },
        { gmailMessageId: "unmatched", outcome: "unmatched" },
        { gmailMessageId: "hit", outcome: "review" },
      ],
      encryptionKey: KEY,
      terms: { ...EMPTY_TERMS, priority: ["urgent"], review: ["review"] },
    });
    expect(candidates.map((c) => c.gmailMessageId)).toEqual(["hit"]);
  });

  test("skips blocked and unmatched without requiring terms", () => {
    const { candidates } = buildAuditCandidates({
      snapshots: [snap("m1"), snap("m2"), snap("m3"), snap("m4")],
      outcomes: [
        { gmailMessageId: "m1", outcome: "priority" },
        { gmailMessageId: "m2", outcome: "protected" },
        { gmailMessageId: "m3", outcome: "blocked" },
        { gmailMessageId: "m4", outcome: "unmatched" },
      ],
      encryptionKey: KEY,
    });
    expect(candidates.map((c) => c.gmailMessageId)).toEqual(["m1"]);
  });

  test("skips already-judged ids on resume", () => {
    const { candidates } = buildAuditCandidates({
      snapshots: [
        snap("m1", "a@x", "priority urgent"),
        snap("m2", "a@x", "brand new lead"),
      ],
      outcomes: [
        { gmailMessageId: "m1", outcome: "review" },
        { gmailMessageId: "m2", outcome: "new" },
      ],
      encryptionKey: KEY,
      alreadyJudgedIds: new Set(["m1"]),
      terms: { priority: ["urgent"], review: [], new: ["new"] },
    });
    expect(candidates.map((c) => c.gmailMessageId)).toEqual(["m2"]);
  });

  test("skips failed and missing outcomes", () => {
    const { candidates } = buildAuditCandidates({
      snapshots: [snap("m1"), snap("m2"), snap("orphan")],
      outcomes: [
        { gmailMessageId: "m1", outcome: "failed" },
        { gmailMessageId: "m2", outcome: "review" },
      ],
      encryptionKey: KEY,
    });
    expect(candidates.map((c) => c.gmailMessageId)).toEqual(["m2"]);
    expect(candidates[0]?.outcome).toBe("review");
  });

  test("reports decrypt failures instead of silent omission", () => {
    const { candidates, decryptFailures } = buildAuditCandidates({
      snapshots: [
        snap("ok", "a@x", "urgent please"),
        {
          gmailMessageId: "bad",
          encryptedPayload: "not-valid-ciphertext",
          keyVersion: 1,
        },
      ],
      outcomes: [
        { gmailMessageId: "ok", outcome: "priority" },
        { gmailMessageId: "bad", outcome: "review" },
      ],
      encryptionKey: KEY,
      terms: { priority: ["urgent"], review: [], new: [] },
    });
    expect(candidates.map((c) => c.gmailMessageId)).toEqual(["ok"]);
    expect(decryptFailures).toEqual(["bad"]);
  });
});
