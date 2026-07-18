import { describe, expect, test } from "bun:test";
import { classifyMessage, classifyWithReason, normalizeTerms, parseMailboxAddress } from "../server/gmail/classify";
import type { ParsedMessage } from "../server/gmail/message";

const message = (overrides: Partial<ParsedMessage> = {}): ParsedMessage => ({
  id: "m1",
  threadId: "t1",
  internalDate: null,
  labelIds: ["source"],
  from: "Sender <sender@example.com>",
  replyTo: "",
  subject: "",
  bodyText: "",
  ...overrides,
});
const terms = { priority: ["urgent"], review: ["review me"], newContest: ["new contest"] };

describe("local deterministic classification", () => {
  test("normalizes, deduplicates, and applies Unicode token boundaries", () => {
    expect(normalizeTerms(["  ＵＲＧＥＮＴ  ", "urgent"])).toEqual(["urgent"]);
    expect(classifyMessage(message({ bodyText: "This is URGENT!" }), terms, [])).toBe("priority");
    expect(classifyMessage(message({ bodyText: "an urgently written note" }), terms, [])).toBe("unmatched");
  });

  test("matches whole words only, not substrings inside larger tokens", () => {
    const shortTerms = { priority: ["win", "ai"], review: [], newContest: [] };
    expect(classifyMessage(message({ subject: "You can win today" }), shortTerms, [])).toBe("priority");
    expect(classifyMessage(message({ subject: "winning streak" }), shortTerms, [])).toBe("unmatched");
    expect(classifyMessage(message({ bodyText: "AI tools" }), shortTerms, [])).toBe("priority");
    expect(classifyMessage(message({ bodyText: "your email arrived" }), shortTerms, [])).toBe("unmatched");
    expect(classifyMessage(message({ subject: "winner, rewinding" }), shortTerms, [])).toBe("unmatched");
  });

  test("does not match contraction prefixes across apostrophes", () => {
    const shortTerms = { priority: ["won", "can", "don"], review: [], newContest: [] };
    expect(classifyMessage(message({ bodyText: "I won't attend" }), shortTerms, [])).toBe("unmatched");
    expect(classifyMessage(message({ bodyText: "I can't attend" }), shortTerms, [])).toBe("unmatched");
    expect(classifyMessage(message({ bodyText: "I can’t attend" }), shortTerms, [])).toBe("unmatched"); // U+2019
    expect(classifyMessage(message({ bodyText: "don't bother" }), shortTerms, [])).toBe("unmatched");
    expect(classifyMessage(message({ bodyText: "I won today" }), shortTerms, [])).toBe("priority");
    expect(classifyMessage(message({ bodyText: "yes we can" }), shortTerms, [])).toBe("priority");

    const literalContraction = { priority: ["won't"], review: [], newContest: [] };
    expect(classifyMessage(message({ bodyText: "I won't attend" }), literalContraction, [])).toBe("priority");
    expect(classifyMessage(message({ bodyText: "I won today" }), literalContraction, [])).toBe("unmatched");
  });

  test("uses priority then review then contest precedence", () => {
    expect(classifyMessage(message({ subject: "new contest; review me; urgent" }), terms, [])).toBe("priority");
    expect(classifyMessage(message({ subject: "new contest — review   me" }), terms, [])).toBe("review");
    expect(classifyMessage(message({ subject: "A new contest" }), terms, [])).toBe("new_contest");
  });

  test("protects exact whitelisted senders and ambiguous sender headers", () => {
    expect(parseMailboxAddress("Person <USER@Example.COM>")).toBe("user@example.com");
    expect(parseMailboxAddress("\"Doe, Jane\" <jane@example.com>")).toBe("jane@example.com");
    expect(parseMailboxAddress("A <a@example.com>, B <b@example.com>")).toBeNull();
    expect(parseMailboxAddress("Friends: a@example.com, b@example.com;")).toBeNull();
    expect(classifyMessage(message({ from: "Person <sender@example.com>", subject: "urgent" }), terms, ["sender@example.com"])).toBe("protected");
    expect(classifyMessage(message({ from: "Sender Name", subject: "urgent" }), terms, [])).toBe("protected");
    expect(classifyMessage(
      message({ from: "A <a@example.com>, B <b@example.com>", subject: "urgent" }),
      terms,
      [],
    )).toBe("protected");
  });

  test("starred messages are protected and skip term/blocklist classification", () => {
    expect(classifyMessage(message({
      labelIds: ["source", "STARRED"],
      subject: "urgent",
      bodyText: "new contest review me",
    }), terms, [], ["sender@example.com"])).toBe("protected");
    expect(classifyMessage(message({
      labelIds: ["STARRED"],
      from: "Spam <spam@example.com>",
      subject: "urgent",
    }), terms, [], ["spam@example.com"])).toBe("protected");
  });

  test("blocklists senders before term matching; whitelist wins on overlap", () => {
    expect(classifyMessage(message({ from: "Spam <spam@example.com>", subject: "urgent" }), terms, [], ["spam@example.com"])).toBe("blocked");
    expect(classifyMessage(
      message({ from: "Both <both@example.com>", subject: "urgent" }),
      terms,
      ["both@example.com"],
      ["both@example.com"],
    )).toBe("protected");
  });

  test("explains protected and processed outcomes with brief reasons", () => {
    expect(classifyWithReason(message({ labelIds: ["STARRED"], subject: "urgent" }), terms, [])).toEqual({
      outcome: "protected",
      reason: "Starred in Gmail",
    });
    expect(classifyWithReason(message({ from: "Sender Name", subject: "urgent" }), terms, [])).toEqual({
      outcome: "protected",
      reason: "Sender could not be parsed",
    });
    expect(classifyWithReason(message({ subject: "urgent" }), terms, ["sender@example.com"])).toEqual({
      outcome: "protected",
      reason: "Sender is on the whitelist",
    });
    expect(classifyWithReason(message({ from: "Spam <spam@example.com>" }), terms, [], ["spam@example.com"])).toEqual({
      outcome: "blocked",
      reason: "Sender is on the blocklist",
    });
    expect(classifyWithReason(message({ bodyText: "This is URGENT!" }), terms, [])).toEqual({
      outcome: "priority",
      reason: "Matched priority term “urgent”",
    });
    expect(classifyWithReason(message({ subject: "review me please" }), terms, [])).toEqual({
      outcome: "review",
      reason: "Matched review term “review me”",
    });
    expect(classifyWithReason(message({ subject: "hello" }), terms, [])).toEqual({
      outcome: "unmatched",
      reason: "No classification terms matched",
    });
  });

  test("rejects empty and oversized configuration", () => {
    expect(() => normalizeTerms(["   "])).toThrow("Invalid classification term");
    expect(() => normalizeTerms(Array.from({ length: 101 }, (_, index) => `term ${index}`))).toThrow("Too many");
  });
});
