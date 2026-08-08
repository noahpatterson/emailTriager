import { isGmailStarred, type ParsedMessage } from "./message";

export type ClassificationOutcome = "priority" | "review" | "new" | "unmatched" | "protected" | "blocked";
export type TermMatchCategory = "priority" | "review" | "new";
/** Window of normalized corpus around the matched term (for judge / review). */
export type TermMatchEvidence = Readonly<{
  category: TermMatchCategory;
  term: string;
  excerpt: string;
}>;
export type ClassificationResult = Readonly<{
  outcome: ClassificationOutcome;
  reason: string;
  match: TermMatchEvidence | null;
}>;
export type ClassificationTerms = Readonly<{
  priority: readonly string[];
  review: readonly string[];
  new: readonly string[];
}>;
/** Characters of normalized corpus kept on each side of the matched term. */
export const DEFAULT_MATCH_CONTEXT_CHARS = 80;

const MAX_TERMS_PER_CATEGORY = 100;
const MAX_TERM_LENGTH = 200;
const MAILBOX_PATTERN = /^[^\s<>@,]+@[^\s<>@,]+$/u;

export function normalizeMatchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("und").trim().replace(/\s+/gu, " ");
}

export function normalizeTerms(terms: readonly string[]): readonly string[] {
  if (terms.length > MAX_TERMS_PER_CATEGORY) throw new Error("Too many classification terms");
  const normalized = terms.map(normalizeMatchText);
  if (normalized.some((term) => !term || term.length > MAX_TERM_LENGTH)) throw new Error("Invalid classification term");
  return [...new Set(normalized)];
}

/** Letters/numbers/marks/underscore, plus apostrophes that join contraction/possessive parts. */
const TOKEN_CHARACTER = /[\p{L}\p{N}\p{M}_'\u2019]/u;

/** First word-boundary match offset, or -1. */
function findTermMatchOffset(corpus: string, term: string): number {
  let offset = corpus.indexOf(term);
  while (offset !== -1) {
    const before = offset === 0 ? "" : corpus[offset - 1] ?? "";
    const after = corpus[offset + term.length] ?? "";
    if (!TOKEN_CHARACTER.test(before) && !TOKEN_CHARACTER.test(after)) return offset;
    offset = corpus.indexOf(term, offset + 1);
  }
  return -1;
}

export function excerptAroundMatch(
  corpus: string,
  offset: number,
  termLength: number,
  radius: number = DEFAULT_MATCH_CONTEXT_CHARS,
): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(corpus.length, offset + termLength + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < corpus.length ? "…" : "";
  return `${prefix}${corpus.slice(start, end)}${suffix}`;
}

function matchCorpusFor(
  message: Readonly<Pick<ParsedMessage, "from" | "replyTo" | "subject" | "bodyText">>,
): string {
  return normalizeMatchText(
    [message.from, message.replyTo, message.subject, message.bodyText].join("\n"),
  );
}

/**
 * Same first-match-wins scan as classify, returning the matched term and a
 * surrounding excerpt of the normalized corpus (empty when no term matched).
 */
export function findClassificationMatch(
  message: Readonly<Pick<ParsedMessage, "from" | "replyTo" | "subject" | "bodyText">>,
  terms: ClassificationTerms,
): TermMatchEvidence | null {
  const corpus = matchCorpusFor(message);
  const categories = [
    ["priority", terms.priority],
    ["review", terms.review],
    ["new", terms.new],
  ] as const;
  for (const [category, configuredTerms] of categories) {
    for (const term of normalizeTerms(configuredTerms)) {
      const offset = findTermMatchOffset(corpus, term);
      if (offset >= 0) {
        return {
          category,
          term,
          excerpt: excerptAroundMatch(corpus, offset, term.length),
        };
      }
    }
  }
  return null;
}

export function formatMatchEvidence(match: TermMatchEvidence): string {
  return `Matched ${match.category} term “${match.term}” near «${match.excerpt}»`;
}

export function parseMailboxAddress(header: string): string | null {
  const value = header.trim();
  const withoutQuotedDisplayNames = value.replace(/"(?:\\.|[^"\\])*"/gu, "\"\"");
  if (!value || /[:,;]/u.test(withoutQuotedDisplayNames)) return null;
  const angleMatches = [...withoutQuotedDisplayNames.matchAll(/<([^<>]+)>/gu)];
  if (angleMatches.length > 1) return null;
  const angleMatch = angleMatches[0];
  const candidate = (angleMatch?.[1] ?? value).trim().normalize("NFKC").toLocaleLowerCase("und");
  if ((withoutQuotedDisplayNames.includes("<") || withoutQuotedDisplayNames.includes(">")) && !angleMatch) {
    return null;
  }
  return MAILBOX_PATTERN.test(candidate) ? candidate : null;
}

export function classifyMessage(
  message: ParsedMessage,
  terms: ClassificationTerms,
  senderWhitelist: readonly string[],
  senderBlocklist: readonly string[] = [],
): ClassificationOutcome {
  return classifyWithReason(message, terms, senderWhitelist, senderBlocklist).outcome;
}

export function classifyWithReason(
  message: ParsedMessage,
  terms: ClassificationTerms,
  senderWhitelist: readonly string[],
  senderBlocklist: readonly string[] = [],
): ClassificationResult {
  // Starred mail is owner-protected: never label-move, even if terms or blocklist would match.
  if (isGmailStarred(message.labelIds)) {
    return { outcome: "protected", reason: "Starred in Gmail", match: null };
  }
  const sender = parseMailboxAddress(message.from);
  if (!sender) {
    return { outcome: "protected", reason: "Sender could not be parsed", match: null };
  }
  const whitelist = new Set(senderWhitelist.map((address) => parseMailboxAddress(address)).filter((address): address is string => address !== null));
  if (whitelist.has(sender)) {
    return { outcome: "protected", reason: "Sender is on the whitelist", match: null };
  }
  const blocklist = new Set(senderBlocklist.map((address) => parseMailboxAddress(address)).filter((address): address is string => address !== null));
  if (blocklist.has(sender)) {
    return { outcome: "blocked", reason: "Sender is on the blocklist", match: null };
  }

  const match = findClassificationMatch(message, terms);
  if (match) {
    return {
      outcome: match.category,
      reason: formatMatchEvidence(match),
      match,
    };
  }
  return { outcome: "unmatched", reason: "No classification terms matched", match: null };
}
