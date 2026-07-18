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

  test("honors declared charsets and decodes RFC 2047 headers", () => {
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString("base64url");
    const parsed = parseGmailMessage({
      id: "m",
      threadId: "t",
      payload: {
        mimeType: "text/plain; charset=iso-8859-1",
        headers: [
          { name: "From", value: "=?ISO-8859-1?Q?Andr=E9?= <andre@example.com>" },
          { name: "Subject", value: "=?ISO-8859-1?Q?Caf=E9?=\r\n promotion" },
        ],
        body: { data: latin1 },
      },
    });
    expect(parsed.from).toBe("André <andre@example.com>");
    expect(parsed.subject).toBe("Café promotion");
    expect(parsed.bodyText).toBe("café");
  });

  test("fails closed on invalid bytes for the declared charset", () => {
    expect(() => parseGmailMessage({
      id: "m",
      threadId: "t",
      payload: {
        mimeType: "text/plain; charset=utf-8",
        body: { data: Buffer.from([0xc3, 0x28]).toString("base64url") },
      },
    })).toThrow("charset");
  });

  test("reads charset from Content-Type headers and rejects malformed encoded words", () => {
    const parsed = parseGmailMessage({
      id: "m",
      threadId: "t",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Content-Type", value: "text/plain; charset=iso-8859-1" },
          { name: "From", value: "sender@example.com" },
        ],
        body: { data: Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString("base64url") },
      },
    });
    expect(parsed.bodyText).toBe("café");
    expect(() => parseGmailMessage({
      id: "bad",
      threadId: "t",
      payload: {
        mimeType: "text/plain",
        headers: [{ name: "Subject", value: "=?UTF-8?B?***?=" }],
      },
    })).toThrow("header encoding");
  });
});
