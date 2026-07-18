import { describe, expect, test } from "bun:test";
import { classifyMessage, normalizeTerms, parseMailboxAddress } from "../server/gmail/classify";
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
    expect(classifyMessage(message({ from: "Person <sender@example.com>", subject: "urgent" }), terms, ["sender@example.com"])).toBe("protected");
    expect(classifyMessage(message({ from: "Sender Name", subject: "urgent" }), terms, [])).toBe("protected");
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

  test("rejects empty and oversized configuration", () => {
    expect(() => normalizeTerms(["   "])).toThrow("Invalid classification term");
    expect(() => normalizeTerms(Array.from({ length: 101 }, (_, index) => `term ${index}`))).toThrow("Too many");
  });
});
