import { describe, expect, test } from "bun:test";
import { CONTEST_ARCHIVE_PURGE_CONFIRM } from "../server/gmail/contest-archive-purge-confirm";
import { trashListedContestArchiveMessages } from "../server/gmail/contest-archive-trash-messages";
import { DeterministicGmailFake } from "../server/gmail/fake";
import { listBounded } from "../server/gmail/sync";

describe("contest-archive purge helpers", () => {
  test("confirm token is exact and trash uses provider.trashMessage", async () => {
    expect(CONTEST_ARCHIVE_PURGE_CONFIRM).toBe("DELETE_CONTEST_ARCHIVE");
    const fake = new DeterministicGmailFake({
      first: { messages: [{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t2" }] },
    }, {
      m1: { id: "m1", threadId: "t1", labelIds: ["archive"] },
      m2: { id: "m2", threadId: "t2", labelIds: ["archive"] },
    }, [
      { id: "archive", name: "Triage/Contest archive" },
    ]);
    const listed = await listBounded(fake, "archive", { maxPages: 1, maxMessagesPerPage: 50, maxTotalMessages: 50 });
    let fenceChecks = 0;
    const result = await trashListedContestArchiveMessages(
      fake,
      listed.messageIds,
      "archive",
      async () => { fenceChecks += 1; },
    );
    expect(result).toEqual({ trashedCount: 2, skippedStarredCount: 0 });
    expect(fake.trashed).toEqual(["m1", "m2"]);
    expect(fake.mutations).toEqual([]);
    expect(fenceChecks).toBe(2);
  });

  test("skips starred messages and does not trash them", async () => {
    const fake = new DeterministicGmailFake({
      first: { messages: [{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t2" }, { id: "m3", threadId: "t3" }] },
    }, {
      m1: { id: "m1", threadId: "t1", labelIds: ["archive"] },
      m2: { id: "m2", threadId: "t2", labelIds: ["archive", "STARRED"] },
      m3: { id: "m3", threadId: "t3", labelIds: ["archive"] },
    });
    const result = await trashListedContestArchiveMessages(fake, ["m1", "m2", "m3"], "archive");
    expect(result).toEqual({ trashedCount: 2, skippedStarredCount: 1 });
    expect(fake.trashed).toEqual(["m1", "m3"]);
  });

  test("rechecks archive membership and the exclusive lease before trashing", async () => {
    const fake = new DeterministicGmailFake({}, {
      moved: { id: "moved", threadId: "t1", labelIds: ["other"] },
      archived: { id: "archived", threadId: "t2", labelIds: ["archive"] },
    });
    let checks = 0;
    await expect(trashListedContestArchiveMessages(
      fake,
      ["moved", "archived"],
      "archive",
      async () => {
        checks += 1;
        throw new Error("Purge lease lost");
      },
    )).rejects.toThrow("lease lost");
    expect(checks).toBe(1);
    expect(fake.trashed).toEqual([]);
  });
});
