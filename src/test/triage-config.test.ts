import { describe, expect, test } from "bun:test";
import {
  normalizeTriageConfig,
  parseTermList,
  validateBounds,
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

  test("normalizes terms, whitelist, and blocklist on save", () => {
    const config = normalizeTriageConfig({
      sourceLabelId: " Label_src ",
      priorityLabelId: "Label_pri",
      reviewLabelId: "Label_rev",
      newLabelId: "Label_new",
      archiveLabelId: "Label_arc",
      terms: { priority: [" Urgent ", "urgent"], review: ["needs review"], new: ["New Inquiry"] },
      senderWhitelist: ["Person <Owner@Example.com>", "owner@example.com"],
      senderBlocklist: ["Spam <Spam@Example.com>"],
      bounds: { maxPages: 2, maxMessagesPerPage: 25, maxTotalMessages: 40 },
    });
    expect(config.sourceLabelId).toBe("Label_src");
    expect(config.archiveLabelId).toBe("Label_arc");
    expect(config.terms.priority).toEqual(["urgent"]);
    expect(config.senderWhitelist).toEqual(["owner@example.com"]);
    expect(config.senderBlocklist).toEqual(["spam@example.com"]);
    expect(validateBounds(config.bounds)).toEqual(config.bounds);
    expect(validateSenderWhitelist(["a@b.co"])).toEqual(["a@b.co"]);
    expect(validateSenderBlocklist(["c@d.co"])).toEqual(["c@d.co"]);
  });
});
