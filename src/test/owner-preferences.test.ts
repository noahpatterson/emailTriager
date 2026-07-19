import { describe, expect, test } from "bun:test";
import {
  DEFAULT_GMAIL_MESSAGE_LINK_ROOT,
  normalizeGmailMessageLinkRoot,
} from "../server/config/owner-preferences-validate";

describe("gmail message link root", () => {
  test("normalizes trailing slash and accepts account indexes", () => {
    expect(normalizeGmailMessageLinkRoot("https://mail.google.com/mail/u/0"))
      .toBe("https://mail.google.com/mail/u/0/");
    expect(normalizeGmailMessageLinkRoot("https://mail.google.com/mail/u/2/"))
      .toBe("https://mail.google.com/mail/u/2/");
    expect(DEFAULT_GMAIL_MESSAGE_LINK_ROOT).toBe("https://mail.google.com/mail/u/0/");
  });

  test("rejects non-Gmail roots", () => {
    expect(() => normalizeGmailMessageLinkRoot("https://example.com/mail/u/0/"))
      .toThrow(/Gmail message link root/);
    expect(() => normalizeGmailMessageLinkRoot("https://mail.google.com/mail/u/abc/"))
      .toThrow(/Gmail message link root/);
  });
});
