import { DeterministicGmailFake } from "@/src/server/gmail/fake";
import type { GmailPage } from "@/src/server/gmail/contracts";
import type { GmailMessage } from "@/src/server/gmail/message";
import {
  ADVERSARIAL_CORPUS,
  DEMO_CORPUS_LABELS,
  DEMO_CORPUS_SOURCE_LABEL_ID,
  type CorpusFixture,
} from "@/src/server/gmail/corpus";

const encoded = (value: string): string => Buffer.from(value).toString("base64url");

/** Build the Gmail message payload shape used by the fake and by classify tests. */
export function fixtureToGmailMessage(fixture: CorpusFixture): GmailMessage {
  return {
    id: fixture.id,
    threadId: fixture.threadId,
    labelIds: [DEMO_CORPUS_SOURCE_LABEL_ID],
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: fixture.from },
        { name: "Subject", value: fixture.subject },
      ],
      body: { data: encoded(fixture.body) },
    },
  };
}

/** Paginate corpus into fixed-size pages for deterministic listMessages. */
export function corpusPages(
  corpus: readonly CorpusFixture[],
  pageSize = 25,
): Readonly<Record<string, GmailPage>> {
  if (pageSize < 1) throw new Error("pageSize must be >= 1");
  const pages: Record<string, GmailPage> = {};
  for (let offset = 0, pageIndex = 0; offset < corpus.length; offset += pageSize, pageIndex += 1) {
    const slice = corpus.slice(offset, offset + pageSize);
    const token = pageIndex === 0 ? "first" : `p${pageIndex + 1}`;
    const nextOffset = offset + pageSize;
    pages[token] = {
      messages: slice.map((row) => ({ id: row.id, threadId: row.threadId })),
      ...(nextOffset < corpus.length
        ? { nextPageToken: `p${pageIndex + 2}` }
        : {}),
    };
  }
  return pages;
}

/** Build a DeterministicGmailFake seeded from the adversarial corpus (or a subset). */
export function seedGmailFakeFromCorpus(
  corpus: readonly CorpusFixture[] = ADVERSARIAL_CORPUS,
  pageSize = 25,
): DeterministicGmailFake {
  const messages = Object.fromEntries(
    corpus.map((fixture) => [fixture.id, fixtureToGmailMessage(fixture)]),
  );
  return new DeterministicGmailFake(
    corpusPages(corpus, pageSize),
    messages,
    [...DEMO_CORPUS_LABELS],
  );
}
