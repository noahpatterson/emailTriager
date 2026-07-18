import { describe, expect, test } from "bun:test";
import {
  displayLabelName,
  displayLabelRefs,
  resolveLabelRef,
  resolveLabelRefs,
} from "../server/gmail/labels";

const catalog = [
  { id: "Label_1", name: "Triage/Source" },
  { id: "Label_2", name: "Triage/Priority" },
  { id: "Label_3", name: "Triage/Review" },
  { id: "Label_4", name: "Triage/New contest" },
  { id: "Label_5", name: "Triage/Contest archive" },
  { id: "INBOX", name: "INBOX" },
  { id: "TRASH", name: "TRASH" },
] as const;

describe("Gmail label name resolution", () => {
  test("maps result label ids to user-facing names", () => {
    expect(displayLabelName("Label_2", catalog)).toBe("Triage/Priority");
    expect(displayLabelName(null, catalog)).toBeNull();
  });

  test("resolves names case-insensitively and accepts ids", () => {
    expect(resolveLabelRef("triage/source", catalog).id).toBe("Label_1");
    expect(resolveLabelRef("Label_2", catalog).name).toBe("Triage/Priority");
  });

  test("rejects missing, forbidden, and duplicate destination labels", () => {
    expect(() => resolveLabelRef("Missing", catalog)).toThrow("was not found");
    expect(() => resolveLabelRef("TRASH", catalog)).toThrow("not allowed");
    expect(() => resolveLabelRefs({
      sourceLabelId: "Triage/Source",
      priorityLabelId: "Triage/Source",
      reviewLabelId: "Triage/Review",
      contestLabelId: "Triage/New contest",
      contestArchiveLabelId: "Triage/Contest archive",
    }, catalog)).toThrow("distinct");
  });

  test("maps stored ids back to display names for the form", () => {
    expect(displayLabelRefs({
      sourceLabelId: "Label_1",
      priorityLabelId: "Label_2",
      reviewLabelId: "Label_3",
      contestLabelId: "Label_4",
      contestArchiveLabelId: "Label_5",
    }, catalog)).toEqual({
      sourceLabelId: "Triage/Source",
      priorityLabelId: "Triage/Priority",
      reviewLabelId: "Triage/Review",
      contestLabelId: "Triage/New contest",
      contestArchiveLabelId: "Triage/Contest archive",
    });
  });
});
