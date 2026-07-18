import { describe, expect, test } from "bun:test";
import { listBounded } from "../server/gmail/sync";
import { GoogleGmailProvider } from "../server/gmail/google";
import { DeterministicGmailFake } from "../server/gmail/fake";
import { decryptSecret, encryptSecret } from "../server/security/crypto";

describe("OAuth token protection", () => { test("encrypts tokens with authenticated encryption", () => { const encrypted = encryptSecret("refresh-secret", "test-key"); expect(encrypted).not.toContain("refresh-secret"); expect(decryptSecret(encrypted, "test-key")).toBe("refresh-secret"); expect(() => decryptSecret(`${encrypted}x`, "test-key")).toThrow(); }); });
describe("bounded Gmail listing", () => {
  test("stops at page bound and returns resumable cursor", async () => { const fake = new DeterministicGmailFake({ first: { messages: [{ id: "m1", threadId: "t" }], nextPageToken: "p2" }, p2: { messages: [{ id: "m2", threadId: "t" }] } }); expect(await listBounded(fake, "source", { maxPages: 1, maxMessagesPerPage: 10, maxTotalMessages: 10 })).toEqual({ exhausted: false, messageIds: ["m1"], nextPageToken: "p2" }); });
  test("rejects repeated cursors", async () => { const fake = new DeterministicGmailFake({ first: { messages: [], nextPageToken: "p2" }, p2: { messages: [], nextPageToken: "p2" } }); await expect(listBounded(fake, "source", { maxPages: 3, maxMessagesPerPage: 10, maxTotalMessages: 10 })).rejects.toThrow("cycle"); });
  test("stops at total message bound without requesting maxResults 0", async () => {
    const page = (start: number, next?: string) => ({
      messages: Array.from({ length: 50 }, (_, i) => ({ id: `m${start + i}`, threadId: "t" })),
      ...(next ? { nextPageToken: next } : {}),
    });
    const fake = new DeterministicGmailFake({ first: page(1, "p2"), p2: page(51, "p3"), p3: page(101) });
    const result = await listBounded(fake, "source", { maxPages: 3, maxMessagesPerPage: 50, maxTotalMessages: 100 });
    expect(result.messageIds).toHaveLength(100);
    expect(result.exhausted).toBe(false);
    expect(result.nextPageToken).toBe("p3");
    expect(fake.listMaxResults).toEqual([50, 50]);
    expect(fake.listMaxResults.every((n) => n > 0)).toBe(true);
  });
  test("production adapter never sends a Gmail search query", async () => { let requested = ""; const provider = new GoogleGmailProvider("access", async (input) => { requested = String(input); return new Response(JSON.stringify({ messages: [] }), { status: 200 }); }); await provider.listMessages({ sourceLabelId: "Label_1", maxResults: 20 }); const url = new URL(requested); expect(url.searchParams.get("labelIds")).toBe("Label_1"); expect(url.searchParams.has("q")).toBe(false); });
  test("production adapter rejects invalid maxResults locally", async () => {
    const provider = new GoogleGmailProvider("access", async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    await expect(provider.listMessages({ sourceLabelId: "Label_1", maxResults: 0 })).rejects.toThrow("Invalid maxResults");
    await expect(provider.listMessages({ sourceLabelId: "Label_1", maxResults: 501 })).rejects.toThrow("Invalid maxResults");
  });
});
