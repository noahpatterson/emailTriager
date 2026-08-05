import { describe, expect, test } from "bun:test";
import { usesFixtureGmailProvider } from "../server/gmail/app-profile";
import {
  ADVERSARIAL_CORPUS,
  DEMO_CORPUS_SOURCE_LABEL_ID,
  DEMO_CORPUS_TERMS,
  corpusExemplars,
  corpusHoldout,
  filingCategoryForOutcome,
} from "../server/gmail/corpus";
import { fixtureToGmailMessage, seedGmailFakeFromCorpus } from "../server/gmail/corpus-seed";
import { classifyWithReason } from "../server/gmail/classify";
import { DeterministicGmailFake } from "../server/gmail/fake";
import { googleProviderForOwner } from "../server/gmail/factory";
import { parseGmailMessage } from "../server/gmail/message";
import { destinationFor, listBounded, reconcileLabelMovement } from "../server/gmail/sync";

describe("adversarial corpus", () => {
  test("contains 100 fixtures with disjoint exemplar/holdout partitions", () => {
    expect(ADVERSARIAL_CORPUS).toHaveLength(100);
    const exemplars = corpusExemplars();
    const holdout = corpusHoldout();
    expect(exemplars.length + holdout.length).toBe(100);
    const exemplarIds = new Set(exemplars.map((row) => row.id));
    const holdoutIds = new Set(holdout.map((row) => row.id));
    for (const id of exemplarIds) expect(holdoutIds.has(id)).toBe(false);
    expect(exemplars.length).toBe(25);
    expect(holdout.length).toBe(75);
    expect(ADVERSARIAL_CORPUS.every((row) => row.labelRationale.length > 0)).toBe(true);
  });

  test("marks roughly a quarter as deliberate misfiles against DEMO_CORPUS_TERMS", () => {
    const deliberate = ADVERSARIAL_CORPUS.filter((row) => row.deliberateMisfile);
    expect(deliberate.length).toBeGreaterThanOrEqual(20);
    expect(deliberate.length).toBeLessThanOrEqual(30);

    let confirmedMisfiles = 0;
    for (const fixture of ADVERSARIAL_CORPUS) {
      const parsed = parseGmailMessage(fixtureToGmailMessage(fixture));
      const { outcome } = classifyWithReason(parsed, DEMO_CORPUS_TERMS, [], []);
      const filed = filingCategoryForOutcome(outcome);
      const mismatch = filed !== null && filed !== fixture.ownerLabel;
      if (fixture.deliberateMisfile) {
        expect(mismatch).toBe(true);
        confirmedMisfiles += 1;
      } else {
        expect(mismatch).toBe(false);
      }
    }
    expect(confirmedMisfiles).toBe(deliberate.length);
  });
});

describe("corpus-seeded Gmail fake", () => {
  test("paginates the full corpus deterministically with no network", async () => {
    const fake = seedGmailFakeFromCorpus();
    expect(fake).toBeInstanceOf(DeterministicGmailFake);
    const listed = await listBounded(fake, DEMO_CORPUS_SOURCE_LABEL_ID, {
      maxPages: 10,
      maxMessagesPerPage: 25,
      maxTotalMessages: 100,
    });
    expect(listed.messageIds).toHaveLength(100);
    expect(listed.exhausted).toBe(true);
    expect(listed.messageIds).toEqual(ADVERSARIAL_CORPUS.map((row) => row.id));

    for (const id of listed.messageIds) {
      const raw = await fake.getMessage(id);
      const parsed = parseGmailMessage(raw as Parameters<typeof parseGmailMessage>[0]);
      expect(parsed.id).toBe(id);
      classifyWithReason(parsed, DEMO_CORPUS_TERMS, [], []);
    }
    expect(fake.listMaxResults.every((n) => n > 0)).toBe(true);
  });

  test("end-to-end sync seam classifies and mutates against seeded fake", async () => {
    const fake = seedGmailFakeFromCorpus(ADVERSARIAL_CORPUS.slice(0, 10), 5);
    const labels = {
      sourceLabelId: DEMO_CORPUS_SOURCE_LABEL_ID,
      priorityLabelId: "Label_priority",
      reviewLabelId: "Label_review",
      newLabelId: "Label_new",
      archiveLabelId: "Label_archive",
    };
    const listed = await listBounded(fake, labels.sourceLabelId, {
      maxPages: 3,
      maxMessagesPerPage: 5,
      maxTotalMessages: 10,
    });
    expect(listed.messageIds).toHaveLength(10);

    for (const messageId of listed.messageIds) {
      const parsed = parseGmailMessage(
        await fake.getMessage(messageId) as Parameters<typeof parseGmailMessage>[0],
      );
      const { outcome } = classifyWithReason(parsed, DEMO_CORPUS_TERMS, [], []);
      await reconcileLabelMovement(fake, parsed, outcome, labels);
      const dest = destinationFor(outcome, labels);
      if (dest) {
        expect(fake.mutations.some((m) => m.messageId === messageId && m.addLabelIds.includes(dest))).toBe(true);
      }
    }
    expect(fake.mutations.length).toBeGreaterThan(0);
  });
});

describe("APP_PROFILE Gmail provider selection", () => {
  test("demo and ci profiles select fixture Gmail; others use live Google path", () => {
    expect(usesFixtureGmailProvider("demo")).toBe(true);
    expect(usesFixtureGmailProvider("ci")).toBe(true);
    expect(usesFixtureGmailProvider("local-compose")).toBe(false);
    expect(usesFixtureGmailProvider("")).toBe(false);
    expect(usesFixtureGmailProvider("production")).toBe(false);
  });

  test("factory returns DeterministicGmailFake for demo without network", async () => {
    const previous = process.env.APP_PROFILE;
    process.env.APP_PROFILE = "demo";
    try {
      const provider = await googleProviderForOwner("any-owner");
      expect(provider).toBeInstanceOf(DeterministicGmailFake);
      const page = await provider.listMessages({
        sourceLabelId: DEMO_CORPUS_SOURCE_LABEL_ID,
        maxResults: 25,
      });
      expect(page.messages.length).toBeGreaterThan(0);
      expect(page.messages[0]?.id).toBe(ADVERSARIAL_CORPUS[0]?.id);
    } finally {
      if (previous === undefined) delete process.env.APP_PROFILE;
      else process.env.APP_PROFILE = previous;
    }
  });
});
