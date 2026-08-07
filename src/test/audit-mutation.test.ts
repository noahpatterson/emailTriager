import { describe, expect, test } from "bun:test";
import type { ClassificationOutcome } from "../server/gmail/classify";
import type { Category } from "../server/gmail/corpus";
import { decideAuditMutation } from "../server/gmail/audit-mutation";

type Case = Readonly<{
  name: string;
  outcome: ClassificationOutcome | "failed";
  recommended: Category;
  autoApply: boolean;
  malformed?: boolean;
  agrees?: boolean;
  expect: "skip" | "promote" | "pending_demotion";
}>;

const cases: readonly Case[] = [
  {
    name: "malformed verdict never mutates",
    outcome: "unmatched",
    recommended: "priority",
    autoApply: true,
    malformed: true,
    agrees: false,
    expect: "skip",
  },
  {
    name: "agreeing verdict never mutates",
    outcome: "priority",
    recommended: "priority",
    autoApply: true,
    agrees: true,
    expect: "skip",
  },
  {
    name: "protected filing has no category and is skipped",
    outcome: "protected",
    recommended: "priority",
    autoApply: true,
    agrees: false,
    expect: "skip",
  },
  {
    name: "failed filing has no category and is skipped",
    outcome: "failed",
    recommended: "priority",
    autoApply: true,
    agrees: false,
    expect: "skip",
  },
  {
    name: "promotion from archive applies when auto-apply on",
    outcome: "unmatched",
    recommended: "priority",
    autoApply: true,
    agrees: false,
    expect: "promote",
  },
  {
    name: "promotion from blocked (archive) applies when auto-apply on",
    outcome: "blocked",
    recommended: "review",
    autoApply: true,
    agrees: false,
    expect: "promote",
  },
  {
    name: "upward promotion among active categories when auto-apply on",
    outcome: "new",
    recommended: "review",
    autoApply: true,
    agrees: false,
    expect: "promote",
  },
  {
    name: "promotion skipped when auto-apply off",
    outcome: "unmatched",
    recommended: "priority",
    autoApply: false,
    agrees: false,
    expect: "skip",
  },
  {
    name: "demotion to archive queues pending confirmation",
    outcome: "priority",
    recommended: "archive",
    autoApply: true,
    agrees: false,
    expect: "pending_demotion",
  },
  {
    name: "demotion to archive queues even when auto-apply off",
    outcome: "review",
    recommended: "archive",
    autoApply: false,
    agrees: false,
    expect: "pending_demotion",
  },
  {
    name: "already-archived demotion recommendation is a no-op skip",
    outcome: "unmatched",
    recommended: "archive",
    autoApply: true,
    agrees: false,
    expect: "skip",
  },
  {
    name: "lateral non-archive demotion is out of scope and skipped",
    outcome: "priority",
    recommended: "new",
    autoApply: true,
    agrees: false,
    expect: "skip",
  },
];

describe("audit mutation policy", () => {
  for (const row of cases) {
    test(row.name, () => {
      expect(
        decideAuditMutation({
          deterministicOutcome: row.outcome,
          recommendedCategory: row.recommended,
          autoApplyPromotions: row.autoApply,
          malformed: row.malformed ?? false,
          agreesWithFiling: row.agrees ?? false,
        }),
      ).toBe(row.expect);
    });
  }
});
