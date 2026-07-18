import { describe, expect, test } from "bun:test";
import {
  isGmailStarred,
  labelIdsFromGmailMessage,
  parseGmailMessage,
} from "../server/gmail/message";

const encoded = (value: string): string => Buffer.from(value).toString("base64url");

describe("Gmail MIME parsing", () => {
  test("prefers plain text and extracts bounded metadata", () => {
    const parsed = parseGmailMessage({ id: "m1", threadId: "t1", internalDate: "1000", labelIds: ["INBOX"], payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: "Sender <sender@example.com>" }, { name: "Subject", value: "Hello" }], parts: [{ mimeType: "text/html", body: { data: encoded("<script>bad()</script><b>HTML</b>") } }, { mimeType: "text/plain", body: { data: encoded("Plain body") } }] } });
    expect(parsed).toMatchObject({ id: "m1", threadId: "t1", from: "Sender <sender@example.com>", subject: "Hello", bodyText: "Plain body", labelIds: ["INBOX"] });
  });

  test("exposes STARRED from labelIds for protection checks", () => {
    const parsed = parseGmailMessage({
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX", "STARRED", "Label_1"],
      payload: { mimeType: "text/plain", headers: [{ name: "From", value: "a@b.com" }], body: { data: encoded("hi") } },
    });
    expect(parsed.labelIds).toContain("STARRED");
    expect(isGmailStarred(parsed.labelIds)).toBe(true);
    expect(isGmailStarred(labelIdsFromGmailMessage({ id: "m2", labelIds: ["STARRED"] }))).toBe(true);
    expect(isGmailStarred(labelIdsFromGmailMessage({ id: "m3", labelIds: ["INBOX"] }))).toBe(false);
  });

  test("falls back to visible HTML and ignores attachments", () => {
    const parsed = parseGmailMessage({ id: "m", threadId: "t", payload: { mimeType: "multipart/mixed", parts: [{ mimeType: "text/html", body: { data: encoded("<style>.x{}</style><p>A &amp; B</p>") } }, { mimeType: "text/plain", filename: "secret.txt", body: { data: encoded("secret") } }] } });
    expect(parsed.bodyText).toBe("A & B");
    expect(parsed.bodyText).not.toContain("secret");
  });

  test("rejects invalid base64url", () => {
    expect(() => parseGmailMessage({ id: "m", threadId: "t", payload: { mimeType: "text/plain", body: { data: "***" } } })).toThrow("encoding");
  });
});
