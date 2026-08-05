/**
 * Adversarial demo / CI fixture corpus.
 *
 * These messages are easier than real mail: they are constructed to fit categories
 * and known matching seams. The corpus proves triage machinery (sync, fake Gmail,
 * later judge/eval), not that the classifier is strong. See ADR-0008.
 *
 * Each `ownerLabel` is the Owner Label answer key for that fixture (ADR-0008).
 * Deliberate-misfile rows are individually authored against a named matching seam;
 * the classify test locks the answer key to DEMO_CORPUS_TERMS.
 */
import type { ClassificationOutcome } from "@/src/server/gmail/classify";

/** Category destinations a message can be filed into (CONTEXT.md). */
export type Category = "priority" | "review" | "new" | "archive";
export type CorpusPartition = "exemplar" | "holdout";

export type CorpusFixture = Readonly<{
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  /** Owner Label: the category the owner says is correct. */
  ownerLabel: Category;
  /** Disjoint partition: Exemplar Pool vs Holdout. */
  partition: CorpusPartition;
  /**
   * When true, DEMO_CORPUS_TERMS are expected to file this message into a different
   * category than ownerLabel (unmatched/blocked count as archive).
   */
  deliberateMisfile: boolean;
  /** Short answer-key rationale for the Owner Label (audit trail). */
  labelRationale: string;
}>;

/** Term lists the corpus is built to attack. Matching eval and demo sync use these. */
export const DEMO_CORPUS_TERMS = {
  priority: ["urgent", "invoice overdue", "escalate"],
  review: ["please review", "needs decision", "approve"],
  new: ["new inquiry", "first contact", "introduction"],
} as const;

export const DEMO_CORPUS_LABELS = [
  { id: "Label_source", name: "Triage/Source" },
  { id: "Label_priority", name: "Triage/Priority" },
  { id: "Label_review", name: "Triage/Review" },
  { id: "Label_new", name: "Triage/New" },
  { id: "Label_archive", name: "Triage/Archive" },
] as const;

export const DEMO_CORPUS_SOURCE_LABEL_ID = "Label_source";

type Draft = Omit<CorpusFixture, "id" | "threadId" | "partition">;

function pad(index: number): string {
  return String(index).padStart(3, "0");
}

function correct(
  from: string,
  subject: string,
  body: string,
  ownerLabel: Category,
  labelRationale: string,
): Draft {
  return { from, subject, body, ownerLabel, deliberateMisfile: false, labelRationale };
}

function misfile(
  from: string,
  subject: string,
  body: string,
  ownerLabel: Category,
  labelRationale: string,
): Draft {
  return { from, subject, body, ownerLabel, deliberateMisfile: true, labelRationale };
}

/**
 * Build 100 adversarial fixtures. Owner Labels are the audited answer key:
 * correct rows match DEMO_CORPUS_TERMS by design; misfile rows are written one-by-one
 * against ADR-0008 seams and checked by tests.
 */
function buildFixtures(): readonly CorpusFixture[] {
  const drafts: Draft[] = [];

  for (let i = 0; i < 12; i += 1) {
    drafts.push(correct(
      `client${i}@example.com`,
      i % 2 === 0 ? `Urgent: account ${i}` : `Please escalate ticket ${i}`,
      i % 3 === 0
        ? `Invoice overdue on order ${i}. Need a reply today.`
        : `Production is down for customer ${i}.`,
      "priority",
      "Contains a priority Term; Owner Label is priority.",
    ));
  }

  for (let i = 0; i < 12; i += 1) {
    drafts.push(correct(
      `pm${i}@example.com`,
      i % 2 === 0 ? `Please review the draft ${i}` : `Needs decision on budget ${i}`,
      i % 3 === 0
        ? `Can you approve the Q${(i % 4) + 1} plan when you have a moment?`
        : `Attached options for project ${i}.`,
      "review",
      "Contains a review Term; Owner Label is review.",
    ));
  }

  for (let i = 0; i < 12; i += 1) {
    drafts.push(correct(
      `prospect${i}@newco.example`,
      i % 2 === 0 ? `New inquiry about pricing ${i}` : `Introduction — ${i} Corp`,
      i % 3 === 0
        ? `First contact from our team. Interested in a demo.`
        : `We found you online and wanted to say hello.`,
      "new",
      "Contains a new Term; Owner Label is new.",
    ));
  }

  for (let i = 0; i < 39; i += 1) {
    drafts.push(correct(
      `newsletter${i}@promo.example`,
      `Weekly digest #${i}: tips and links`,
      `Here are ${i + 1} articles you might enjoy. Unsubscribe anytime.`,
      "archive",
      "No classification Terms; Owner Label is archive.",
    ));
  }

  // Deliberate misfiles — individually authored against ADR-0008 seams (25).
  drafts.push(
    misfile("deals0@shop.example", "URGENT: 50% off ends tonight", "Flash sale on headphones. Browse if bored.", "archive", "Marketing borrows priority Term “urgent”; true Category is archive."),
    misfile("deals1@shop.example", "URGENT: 51% off sneakers", "Warehouse clearance. No reply expected.", "archive", "Marketing borrows priority Term “urgent”; true Category is archive."),
    misfile("deals2@shop.example", "URGENT: 52% off kitchen kit", "Promo blast only.", "archive", "Marketing borrows priority Term “urgent”; true Category is archive."),
    misfile("deals3@shop.example", "URGENT: 53% off bedding", "One-day storewide event.", "archive", "Marketing borrows priority Term “urgent”; true Category is archive."),
    misfile("deals4@shop.example", "URGENT: 54% off tablets", "Click to shop. Not a work message.", "archive", "Marketing borrows priority Term “urgent”; true Category is archive."),
    misfile("deals5@shop.example", "URGENT: 55% off luggage", "Travel season promo.", "archive", "Marketing borrows priority Term “urgent”; true Category is archive."),
    misfile("deals6@shop.example", "URGENT: 56% off coffee", "Cafe chain coupon mailer.", "archive", "Marketing borrows priority Term “urgent”; true Category is archive."),
    misfile("deals7@shop.example", "URGENT: 57% off candles", "Home goods newsletter.", "archive", "Marketing borrows priority Term “urgent”; true Category is archive."),

    misfile("ops0@corp.example", "Urgently need eyes on outage 0", "The urgency is high but wording avoids exact priority Terms. Customer impact is real.", "priority", "Whole-token seam: “urgently” ≠ Term “urgent”; silent fallthrough to archive while Owner Label is priority."),
    misfile("ops1@corp.example", "Urgently need eyes on outage 1", "Database replica lag. Urgency without the priority Term token.", "priority", "Whole-token seam: “urgently” ≠ Term “urgent”; Owner Label priority."),
    misfile("ops2@corp.example", "Urgently need eyes on outage 2", "Payment webhooks failing. Real ops work, no Term hit.", "priority", "Whole-token seam: “urgently” ≠ Term “urgent”; Owner Label priority."),
    misfile("ops3@corp.example", "Urgently need eyes on outage 3", "CDN origin errors across regions. Act now.", "priority", "Whole-token seam: “urgently” ≠ Term “urgent”; Owner Label priority."),
    misfile("ops4@corp.example", "Urgently need eyes on outage 4", "Auth provider timeouts for enterprise tenants.", "priority", "Whole-token seam: “urgently” ≠ Term “urgent”; Owner Label priority."),
    misfile("ops5@corp.example", "Urgently need eyes on outage 5", "Queue depth climbing; pages are wrong but impact is real.", "priority", "Whole-token seam: “urgently” ≠ Term “urgent”; Owner Label priority."),

    misfile("lead0@corp.example", "Please review before we escalate 0", "Needs decision this week, not an emergency page.", "review", "First-match-wins: “escalate” files priority before “please review”; Owner Label is review."),
    misfile("lead1@corp.example", "Please review before we escalate 1", "Board packet wording only — schedule a decision.", "review", "First-match-wins: priority Term beats review Terms; Owner Label is review."),
    misfile("lead2@corp.example", "Please review before we escalate 2", "Vendor shortlist ready for a calm decision.", "review", "First-match-wins: priority Term beats review Terms; Owner Label is review."),
    misfile("lead3@corp.example", "Please review before we escalate 3", "Policy draft; escalate only if blocked next week.", "review", "First-match-wins: priority Term beats review Terms; Owner Label is review."),

    misfile("bots0@alerts.example", "Status report 0", `${"FYI only. ".repeat(40)}Ignore this automated urgent ping; it is not actionable.`, "archive", "Late-body priority Term in noise alert; Owner Label is archive."),
    misfile("bots1@alerts.example", "Status report 1", `${"FYI only. ".repeat(40)}Ignore this automated urgent ping; dashboard green overall.`, "archive", "Late-body priority Term in noise alert; Owner Label is archive."),
    misfile("bots2@alerts.example", "Status report 2", `${"FYI only. ".repeat(40)}Ignore this automated urgent ping; duplicate of pager noise.`, "archive", "Late-body priority Term in noise alert; Owner Label is archive."),
    misfile("bots3@alerts.example", "Status report 3", `${"FYI only. ".repeat(40)}Ignore this automated urgent ping; training environment only.`, "archive", "Late-body priority Term in noise alert; Owner Label is archive."),

    misfile("growth0@spam.example", "New inquiry from growth partner 0", "Introduction to our SEO package. Cold outreach.", "archive", "Spam uses new Terms; Owner Label is archive."),
    misfile("growth1@spam.example", "New inquiry from growth partner 1", "Introduction to our link-building offer.", "archive", "Spam uses new Terms; Owner Label is archive."),
    misfile("growth2@spam.example", "New inquiry from growth partner 2", "Introduction to our content mill. Delete.", "archive", "Spam uses new Terms; Owner Label is archive."),
  );

  if (drafts.length !== 100) {
    throw new Error(`Corpus must contain 100 fixtures, got ${drafts.length}`);
  }

  const misfileCount = drafts.filter((d) => d.deliberateMisfile).length;
  if (misfileCount < 20 || misfileCount > 30) {
    throw new Error(`Expected ~25 deliberate misfiles, got ${misfileCount}`);
  }

  // Stratified partition: every 4th fixture is Exemplar Pool (25), rest Holdout (75).
  return drafts.map((draft, index) => {
    const id = `fix-${pad(index + 1)}`;
    return {
      ...draft,
      id,
      threadId: `thr-${pad(index + 1)}`,
      partition: index % 4 === 0 ? "exemplar" : "holdout",
    };
  });
}

export const ADVERSARIAL_CORPUS: readonly CorpusFixture[] = buildFixtures();

export function corpusExemplars(
  corpus: readonly CorpusFixture[] = ADVERSARIAL_CORPUS,
): readonly CorpusFixture[] {
  return corpus.filter((row) => row.partition === "exemplar");
}

export function corpusHoldout(
  corpus: readonly CorpusFixture[] = ADVERSARIAL_CORPUS,
): readonly CorpusFixture[] {
  return corpus.filter((row) => row.partition === "holdout");
}

/** Map a Classification Outcome to a Category for misfile checks (unmatched/blocked → archive). */
export function filingCategoryForOutcome(outcome: ClassificationOutcome | "failed"): Category | null {
  if (outcome === "priority" || outcome === "review" || outcome === "new") return outcome;
  if (outcome === "unmatched" || outcome === "blocked") return "archive";
  return null;
}
