import { describe, expect, test } from "bun:test";
import { normalizeMatchText } from "../server/gmail/classify";
import { DeterministicGmailFake } from "../server/gmail/fake";
import { parseGmailMessage } from "../server/gmail/message";
import {
  decryptMessageSnapshotPayload,
  encryptMessageSnapshotPayload,
  messageSnapshotPlaintext,
  persistMessageSnapshotIfEligible,
  shouldPersistMessageSnapshot,
  type MessageSnapshotInsert,
  type MessageSnapshotStore,
} from "../server/gmail/message-snapshot";
import { classifyWithReason, type ClassificationTerms } from "../server/gmail/classify";
import { listBounded } from "../server/gmail/sync";

const KEY = "test-encryption-key-for-snapshots";

class TestSnapshotDatabase implements MessageSnapshotStore {
  readonly rows: MessageSnapshotInsert[] = [];

  async insertSnapshot(row: MessageSnapshotInsert): Promise<void> {
    if (
      this.rows.some(
        (existing) =>
          existing.runId === row.runId && existing.gmailMessageId === row.gmailMessageId,
      )
    ) {
      return;
    }
    this.rows.push(row);
  }
}

const encoded = (value: string): string => Buffer.from(value).toString("base64url");

function fixtureMessage(input: {
  id: string;
  from: string;
  subject: string;
  body: string;
  replyTo?: string;
  labelIds?: readonly string[];
}) {
  const headers = [
    { name: "From", value: input.from },
    { name: "Subject", value: input.subject },
  ];
  if (input.replyTo) headers.push({ name: "Reply-To", value: input.replyTo });
  return {
    id: input.id,
    threadId: `t-${input.id}`,
    labelIds: input.labelIds ?? ["source"],
    payload: {
      mimeType: "text/plain",
      headers,
      body: { data: encoded(input.body) },
    },
  };
}

describe("message snapshot eligibility", () => {
  const eligible = parseGmailMessage(
    fixtureMessage({
      id: "m-elig",
      from: "person@example.com",
      subject: "hi",
      body: "body",
    }),
  );
  const cases = [
    { outcome: "priority" as const, persist: true, parsed: eligible },
    { outcome: "review" as const, persist: true, parsed: eligible },
    { outcome: "new" as const, persist: true, parsed: eligible },
    { outcome: "unmatched" as const, persist: true, parsed: eligible },
    { outcome: "blocked" as const, persist: true, parsed: eligible },
    { outcome: "protected" as const, persist: false, parsed: eligible },
    { outcome: "failed" as const, persist: false, parsed: eligible },
    {
      outcome: "priority" as const,
      persist: false,
      parsed: parseGmailMessage(
        fixtureMessage({
          id: "starred",
          from: "person@example.com",
          subject: "hi",
          body: "body",
          labelIds: ["source", "STARRED"],
        }),
      ),
    },
    {
      outcome: "priority" as const,
      persist: false,
      parsed: parseGmailMessage(
        fixtureMessage({
          id: "bad-from",
          from: "Not An Address",
          subject: "hi",
          body: "body",
        }),
      ),
    },
  ];

  for (const { outcome, persist, parsed } of cases) {
    test(`${outcome} / ${parsed.id} → persist=${persist}`, () => {
      expect(shouldPersistMessageSnapshot(outcome, parsed)).toBe(persist);
    });
  }
});

describe("message snapshot payload", () => {
  test("stores neutral parsed fields and never the match corpus", () => {
    const parsed = parseGmailMessage(
      fixtureMessage({
        id: "m1",
        from: "Sender <sender@example.com>",
        subject: "  Hello  ",
        body: "URGENT please read",
        replyTo: "reply@example.com",
      }),
    );
    const plaintext = messageSnapshotPlaintext(parsed);
    expect(plaintext).toEqual({
      subject: "  Hello  ",
      from: "Sender <sender@example.com>",
      replyTo: "reply@example.com",
      bodyText: "URGENT please read",
    });
    // Store the parsed body, not the matching algorithm's normalized corpus.
    expect(plaintext.bodyText).not.toBe(normalizeMatchText(parsed.bodyText));
    expect(Object.keys(plaintext).sort()).toEqual(["bodyText", "from", "replyTo", "subject"]);
    expect(plaintext).not.toHaveProperty("matchCorpus");
  });

  test("encrypts with the versioned-key scheme and round-trips", () => {
    const plaintext = {
      subject: "s",
      from: "a@b.com",
      replyTo: "",
      bodyText: "secret body",
    };
    const encrypted = encryptMessageSnapshotPayload(plaintext, KEY);
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(encrypted).not.toContain("secret body");
    expect(decryptMessageSnapshotPayload(encrypted, KEY)).toEqual(plaintext);
  });
});

describe("persistMessageSnapshotIfEligible", () => {
  const parsed = parseGmailMessage(
    fixtureMessage({
      id: "m-persist",
      from: "a@example.com",
      subject: "hi",
      body: "body",
    }),
  );

  test("writes encrypted rows for eligible outcomes and skips protected", async () => {
    const store = new TestSnapshotDatabase();
    expect(
      await persistMessageSnapshotIfEligible({
        outcome: "priority",
        parsed,
        ownerAuthUserId: "owner-1",
        runId: "run-1",
        encryptionKey: KEY,
        store,
      }),
    ).toBe(true);
    expect(
      await persistMessageSnapshotIfEligible({
        outcome: "protected",
        parsed,
        ownerAuthUserId: "owner-1",
        runId: "run-1",
        encryptionKey: KEY,
        store,
      }),
    ).toBe(false);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.keyVersion).toBe(1);
    expect(store.rows[0]!.encryptedPayload).not.toContain("body");
    expect(decryptMessageSnapshotPayload(store.rows[0]!.encryptedPayload, KEY).bodyText).toBe(
      "body",
    );
  });

  test("is idempotent for the same run and message", async () => {
    const store = new TestSnapshotDatabase();
    await persistMessageSnapshotIfEligible({
      outcome: "review",
      parsed,
      ownerAuthUserId: "owner-1",
      runId: "run-1",
      encryptionKey: KEY,
      store,
    });
    await persistMessageSnapshotIfEligible({
      outcome: "review",
      parsed,
      ownerAuthUserId: "owner-1",
      runId: "run-1",
      encryptionKey: KEY,
      store,
    });
    expect(store.rows).toHaveLength(1);
  });
});

describe("sync seam snapshot capture with fake Gmail and test database", () => {
  const terms: ClassificationTerms = {
    priority: ["urgent"],
    review: ["review"],
    new: ["inquiry"],
  };

  const cases = [
    {
      id: "priority-mail",
      from: "person@example.com",
      subject: "urgent request",
      body: "please help",
      expectOutcome: "priority" as const,
      expectSnapshot: true,
    },
    {
      id: "blocked-mail",
      from: "spam@example.com",
      subject: "buy now",
      body: "deal",
      expectOutcome: "blocked" as const,
      expectSnapshot: true,
    },
    {
      id: "starred-mail",
      from: "person@example.com",
      subject: "urgent",
      body: "keep me",
      labelIds: ["source", "STARRED"],
      expectOutcome: "protected" as const,
      expectSnapshot: false,
    },
    {
      id: "whitelist-mail",
      from: "friend@example.com",
      subject: "urgent",
      body: "hi",
      expectOutcome: "protected" as const,
      expectSnapshot: false,
    },
    {
      id: "bad-sender",
      from: "Not An Address",
      subject: "urgent",
      body: "hi",
      expectOutcome: "protected" as const,
      expectSnapshot: false,
    },
  ] as const;

  test("captures encrypted snapshots for non-protected outcomes only", async () => {
    const messages = Object.fromEntries(
      cases.map((row) => [
        row.id,
        fixtureMessage({
          id: row.id,
          from: row.from,
          subject: row.subject,
          body: row.body,
          labelIds: "labelIds" in row ? row.labelIds : ["source"],
        }),
      ]),
    );
    const fake = new DeterministicGmailFake(
      {
        first: {
          messages: cases.map((row) => ({ id: row.id, threadId: `t-${row.id}` })),
        },
      },
      messages,
      [
        { id: "source", name: "Triage/Source" },
        { id: "priority", name: "Triage/Priority" },
        { id: "review", name: "Triage/Review" },
        { id: "new", name: "Triage/New" },
        { id: "archive", name: "Triage/Archive" },
      ],
    );
    const listed = await listBounded(fake, "source", {
      maxPages: 1,
      maxMessagesPerPage: 10,
      maxTotalMessages: 10,
    });
    expect(listed.messageIds).toEqual(cases.map((row) => row.id));

    const store = new TestSnapshotDatabase();
    const runId = "run-sync-seam";
    const ownerAuthUserId = "owner-1";
    const whitelist = ["friend@example.com"];
    const blocklist = ["spam@example.com"];

    for (const messageId of listed.messageIds) {
      const parsed = parseGmailMessage(await fake.getMessage(messageId) as Parameters<typeof parseGmailMessage>[0]);
      const { outcome } = classifyWithReason(parsed, terms, whitelist, blocklist);
      const expected = cases.find((row) => row.id === messageId)!;
      expect(outcome).toBe(expected.expectOutcome);
      await persistMessageSnapshotIfEligible({
        outcome,
        parsed,
        ownerAuthUserId,
        runId,
        encryptionKey: KEY,
        store,
      });
    }

    const snappedIds = store.rows.map((row) => row.gmailMessageId).sort();
    expect(snappedIds).toEqual(
      cases.filter((row) => row.expectSnapshot).map((row) => row.id).sort(),
    );
    for (const row of store.rows) {
      expect(row.ownerAuthUserId).toBe(ownerAuthUserId);
      expect(row.runId).toBe(runId);
      expect(row.keyVersion).toBe(1);
      const plaintext = decryptMessageSnapshotPayload(row.encryptedPayload, KEY);
      const fixture = cases.find((c) => c.id === row.gmailMessageId)!;
      expect(plaintext.subject).toBe(fixture.subject);
      expect(plaintext.bodyText).toBe(fixture.body);
      expect(Object.keys(plaintext).sort()).toEqual(["bodyText", "from", "replyTo", "subject"]);
      expect(plaintext).not.toHaveProperty("matchCorpus");
    }
  });
});
