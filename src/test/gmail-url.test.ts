import { describe, expect, test } from "bun:test";
import {
  buildGmailLabelJumps,
  gmailLabelUrl,
  gmailMessageUrl,
  gmailThreadUrl,
} from "../server/gmail/gmail-url";

describe("gmailMessageUrl", () => {
  test("uses the configured message link root", () => {
    expect(gmailMessageUrl(
      { gmailMessageId: "m1", gmailThreadId: "thread99" },
      "https://mail.google.com/mail/u/2/",
    )).toBe("https://mail.google.com/mail/u/2/#all/thread99");
  });

  test("defaults to u/0 and prefers thread id", () => {
    expect(gmailMessageUrl({ gmailMessageId: "m1", gmailThreadId: "thread99" }))
      .toBe("https://mail.google.com/mail/u/0/#all/thread99");
    expect(gmailMessageUrl({ gmailMessageId: "m1", gmailThreadId: null }))
      .toBe("https://mail.google.com/mail/u/0/#all/m1");
    expect(gmailMessageUrl({ gmailMessageId: "m1", gmailThreadId: "   " }))
      .toBe("https://mail.google.com/mail/u/0/#all/m1");
  });

  test("normalizes a missing trailing slash on the root", () => {
    expect(gmailMessageUrl(
      { gmailMessageId: "m1", gmailThreadId: "t1" },
      "https://mail.google.com/mail/u/1",
    )).toBe("https://mail.google.com/mail/u/1/#all/t1");
  });
});

describe("gmailThreadUrl", () => {
  test("builds an #all deep link for a thread id", () => {
    expect(gmailThreadUrl("19f95b6d78a98e98")).toBe(
      "https://mail.google.com/mail/u/0/#all/19f95b6d78a98e98",
    );
  });

  test("honors a custom link root", () => {
    expect(gmailThreadUrl("t1", "https://mail.google.com/mail/u/2/")).toBe(
      "https://mail.google.com/mail/u/2/#all/t1",
    );
  });

  test("returns null for missing ids", () => {
    expect(gmailThreadUrl(null)).toBeNull();
    expect(gmailThreadUrl(undefined)).toBeNull();
    expect(gmailThreadUrl("")).toBeNull();
    expect(gmailThreadUrl("   ")).toBeNull();
  });
});

describe("gmailLabelUrl", () => {
  test("encodes nested label names for the #label deep link", () => {
    expect(gmailLabelUrl("Triage/Priority")).toBe(
      "https://mail.google.com/mail/u/0/#label/Triage%2FPriority",
    );
  });

  test("honors a custom link root", () => {
    expect(gmailLabelUrl("Inbox/Work", "https://mail.google.com/mail/u/2")).toBe(
      "https://mail.google.com/mail/u/2/#label/Inbox%2FWork",
    );
  });

  test("returns null for blank names", () => {
    expect(gmailLabelUrl("")).toBeNull();
    expect(gmailLabelUrl("   ")).toBeNull();
  });
});

describe("buildGmailLabelJumps", () => {
  const catalog = [
    { id: "Label_1", name: "Triage/Source" },
    { id: "Label_2", name: "Triage/Priority" },
    { id: "Label_3", name: "Triage/Review" },
    { id: "Label_4", name: "Triage/New" },
    { id: "Label_5", name: "Triage/Archive" },
  ] as const;

  test("resolves configured ids to named Gmail label links", () => {
    const jumps = buildGmailLabelJumps(
      {
        sourceLabelId: "Label_1",
        priorityLabelId: "Label_2",
        reviewLabelId: "Label_3",
        newLabelId: "Label_4",
        archiveLabelId: "Label_5",
      },
      "https://mail.google.com/mail/u/0/",
      catalog,
    );
    expect(jumps.map((j) => j.title)).toEqual([
      "Source",
      "Priority",
      "Review",
      "New",
      "Archive",
    ]);
    expect(jumps[1]).toEqual({
      key: "priority",
      title: "Priority",
      name: "Triage/Priority",
      href: "https://mail.google.com/mail/u/0/#label/Triage%2FPriority",
    });
  });

  test("returns nothing without a catalog", () => {
    expect(buildGmailLabelJumps(
      {
        sourceLabelId: "Label_1",
        priorityLabelId: "Label_2",
        reviewLabelId: "Label_3",
        newLabelId: "Label_4",
        archiveLabelId: "Label_5",
      },
      "https://mail.google.com/mail/u/0/",
      [],
    )).toEqual([]);
  });
});
