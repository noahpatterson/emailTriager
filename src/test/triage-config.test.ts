import { describe, expect, test } from "bun:test";
import {
  asCategoryIntent,
  assertCompleteCategoryIntent,
  EMPTY_CATEGORY_INTENT,
  hasCompleteCategoryIntent,
  MAX_CATEGORY_INTENT_CHARS,
  normalizeTriageConfig,
  parseTermList,
  validateBounds,
  validateCategoryIntent,
  validateLabelIds,
  validateSenderBlocklist,
  validateSenderWhitelist,
} from "../server/config/triage-validate";

describe("triage configuration validation", () => {
  test("parses comma and newline term lists", () => {
    expect(parseTermList("urgent,  review me\nnew inquiry")).toEqual(["urgent", "review me", "new inquiry"]);
  });

  test("rejects duplicate or forbidden labels", () => {
    expect(() => validateLabelIds({
      sourceLabelId: "Label_1",
      priorityLabelId: "Label_1",
      reviewLabelId: "Label_2",
      newLabelId: "Label_3",
      archiveLabelId: "Label_4",
    })).toThrow("Invalid label configuration");
    expect(() => validateLabelIds({
      sourceLabelId: "TRASH",
      priorityLabelId: "Label_2",
      reviewLabelId: "Label_3",
      newLabelId: "Label_4",
      archiveLabelId: "Label_5",
    })).toThrow("Invalid label configuration");
  });

  test("normalizes terms, whitelist, blocklist, and category intent on save", () => {
    const config = normalizeTriageConfig({
      sourceLabelId: " Label_src ",
      priorityLabelId: "Label_pri",
      reviewLabelId: "Label_rev",
      newLabelId: "Label_new",
      archiveLabelId: "Label_arc",
      terms: { priority: [" Urgent ", "urgent"], review: ["needs review"], new: ["New Inquiry"] },
      senderWhitelist: ["Person <Owner@Example.com>", "owner@example.com"],
      senderBlocklist: ["Spam <Spam@Example.com>"],
      categoryIntent: {
        priority: "  Act today  ",
        review: " Decide soon ",
        new: " First contact ",
        archive: " Noise ",
      },
      bounds: { maxPages: 2, maxMessagesPerPage: 25, maxTotalMessages: 40 },
    });
    expect(config.sourceLabelId).toBe("Label_src");
    expect(config.archiveLabelId).toBe("Label_arc");
    expect(config.terms.priority).toEqual(["urgent"]);
    expect(config.senderWhitelist).toEqual(["owner@example.com"]);
    expect(config.senderBlocklist).toEqual(["spam@example.com"]);
    expect(config.categoryIntent).toEqual({
      priority: "Act today",
      review: "Decide soon",
      new: "First contact",
      archive: "Noise",
    });
    expect(validateBounds(config.bounds)).toEqual(config.bounds);
    expect(validateSenderWhitelist(["a@b.co"])).toEqual(["a@b.co"]);
    expect(validateSenderBlocklist(["c@d.co"])).toEqual(["c@d.co"]);
  });

  test("allows empty category intent on save", () => {
    const config = normalizeTriageConfig({
      sourceLabelId: "Label_src",
      priorityLabelId: "Label_pri",
      reviewLabelId: "Label_rev",
      newLabelId: "Label_new",
      archiveLabelId: "Label_arc",
      terms: { priority: [], review: [], new: [] },
      senderWhitelist: [],
      senderBlocklist: [],
      categoryIntent: EMPTY_CATEGORY_INTENT,
      bounds: { maxPages: 2, maxMessagesPerPage: 25, maxTotalMessages: 40 },
    });
    expect(config.categoryIntent).toEqual(EMPTY_CATEGORY_INTENT);
  });

  test("rejects category intent over the character limit", () => {
    const tooLong = "x".repeat(MAX_CATEGORY_INTENT_CHARS + 1);
    expect(() => validateCategoryIntent({
      priority: tooLong,
      review: "",
      new: "",
      archive: "",
    })).toThrow(`Category intent for priority exceeds ${MAX_CATEGORY_INTENT_CHARS} characters`);
  });

  test("asCategoryIntent defaults missing or partial rows to empty strings", () => {
    expect(asCategoryIntent(null)).toEqual(EMPTY_CATEGORY_INTENT);
    expect(asCategoryIntent(undefined)).toEqual(EMPTY_CATEGORY_INTENT);
    expect(asCategoryIntent({})).toEqual(EMPTY_CATEGORY_INTENT);
    expect(asCategoryIntent({ priority: "P", review: 1, new: null })).toEqual({
      priority: "P",
      review: "",
      new: "",
      archive: "",
    });
  });

  test("completeness check is required for audit runs, not saves", () => {
    expect(hasCompleteCategoryIntent(EMPTY_CATEGORY_INTENT)).toBe(false);
    expect(hasCompleteCategoryIntent({
      priority: "P",
      review: "R",
      new: "N",
      archive: "",
    })).toBe(false);
    expect(hasCompleteCategoryIntent({
      priority: "P",
      review: "R",
      new: "N",
      archive: "A",
    })).toBe(true);
    expect(() => assertCompleteCategoryIntent(EMPTY_CATEGORY_INTENT)).toThrow(
      "Category intent is required for every category before starting an audit run",
    );
  });
});
