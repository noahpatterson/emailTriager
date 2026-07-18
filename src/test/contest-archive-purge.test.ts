import { describe, expect, test } from "bun:test";
import { CONTEST_ARCHIVE_PURGE_CONFIRM } from "../server/gmail/contest-archive-purge-confirm";
import { DeterministicGmailFake } from "../server/gmail/fake";
import { listBounded } from "../server/gmail/sync";

describe("contest-archive purge helpers", () => {
  test("confirm token is exact and trash uses provider.trashMessage", async () => {
    expect(CONTEST_ARCHIVE_PURGE_CONFIRM).toBe("DELETE_CONTEST_ARCHIVE");
    const fake = new DeterministicGmailFake({
      first: { messages: [{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t2" }] },
    }, {}, [
      { id: "archive", name: "Triage/Contest archive" },
    ]);
    const listed = await listBounded(fake, "archive", { maxPages: 1, maxMessagesPerPage: 50, maxTotalMessages: 50 });
    for (const id of listed.messageIds) await fake.trashMessage(id);
    expect(fake.trashed).toEqual(["m1", "m2"]);
    expect(fake.mutations).toEqual([]);
  });
});
