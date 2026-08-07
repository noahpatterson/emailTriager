import { describe, expect, test } from "bun:test";
import { encryptMessageSnapshotPayload } from "../server/gmail/message-snapshot";
import { buildAuditCandidates } from "../server/gmail/audit-candidates";

const KEY = "test-encryption-key-for-audit-candidates";

function snap(id: string, from = "a@example.com") {
  return {
    gmailMessageId: id,
    encryptedPayload: encryptMessageSnapshotPayload(
      { subject: `subj-${id}`, from, replyTo: "", bodyText: `body-${id}` },
      KEY,
    ),
    keyVersion: 1,
  };
}

describe("buildAuditCandidates", () => {
  test("joins snapshots with outcomes and skips protected", () => {
    const { candidates, decryptFailures } = buildAuditCandidates({
      snapshots: [snap("m1"), snap("m2"), snap("m3")],
      outcomes: [
        { gmailMessageId: "m1", outcome: "priority" },
        { gmailMessageId: "m2", outcome: "protected" },
        { gmailMessageId: "m3", outcome: "blocked" },
      ],
      encryptionKey: KEY,
    });
    expect(candidates.map((c) => c.gmailMessageId)).toEqual(["m1", "m3"]);
    expect(candidates.find((c) => c.gmailMessageId === "m3")?.outcome).toBe("blocked");
    expect(decryptFailures).toEqual([]);
  });

  test("skips already-judged ids on resume", () => {
    const { candidates } = buildAuditCandidates({
      snapshots: [snap("m1"), snap("m2")],
      outcomes: [
        { gmailMessageId: "m1", outcome: "review" },
        { gmailMessageId: "m2", outcome: "new" },
      ],
      encryptionKey: KEY,
      alreadyJudgedIds: new Set(["m1"]),
    });
    expect(candidates.map((c) => c.gmailMessageId)).toEqual(["m2"]);
  });

  test("skips failed and missing outcomes", () => {
    const { candidates } = buildAuditCandidates({
      snapshots: [snap("m1"), snap("m2"), snap("orphan")],
      outcomes: [
        { gmailMessageId: "m1", outcome: "failed" },
        { gmailMessageId: "m2", outcome: "unmatched" },
      ],
      encryptionKey: KEY,
    });
    expect(candidates.map((c) => c.gmailMessageId)).toEqual(["m2"]);
    expect(candidates[0]?.outcome).toBe("unmatched");
  });

  test("reports decrypt failures instead of silent omission", () => {
    const { candidates, decryptFailures } = buildAuditCandidates({
      snapshots: [
        snap("ok"),
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
    });
    expect(candidates.map((c) => c.gmailMessageId)).toEqual(["ok"]);
    expect(decryptFailures).toEqual(["bad"]);
  });
});
