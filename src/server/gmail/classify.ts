import type { ParsedMessage } from "./message";

export type ClassificationOutcome = "priority" | "review" | "new_contest" | "unmatched" | "protected" | "blocked";
export type ClassificationTerms = Readonly<{
  priority: readonly string[];
  review: readonly string[];
  newContest: readonly string[];
}>;

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

function termMatches(corpus: string, term: string): boolean {
  let offset = corpus.indexOf(term);
  while (offset !== -1) {
    const before = offset === 0 ? "" : corpus[offset - 1] ?? "";
    const after = corpus[offset + term.length] ?? "";
    if (!TOKEN_CHARACTER.test(before) && !TOKEN_CHARACTER.test(after)) return true;
    offset = corpus.indexOf(term, offset + 1);
  }
  return false;
}

export function parseMailboxAddress(header: string): string | null {
  const value = header.trim();
  const angleMatch = value.match(/<([^<>]+)>/u);
  const candidate = (angleMatch?.[1] ?? value).trim().normalize("NFKC").toLocaleLowerCase("und");
  if ((value.includes("<") || value.includes(">")) && !angleMatch) return null;
  return MAILBOX_PATTERN.test(candidate) ? candidate : null;
}

export function classifyMessage(
  message: ParsedMessage,
  terms: ClassificationTerms,
  senderWhitelist: readonly string[],
  senderBlocklist: readonly string[] = [],
): ClassificationOutcome {
  const sender = parseMailboxAddress(message.from);
  if (!sender) return "protected";
  const whitelist = new Set(senderWhitelist.map((address) => parseMailboxAddress(address)).filter((address): address is string => address !== null));
  if (whitelist.has(sender)) return "protected";
  const blocklist = new Set(senderBlocklist.map((address) => parseMailboxAddress(address)).filter((address): address is string => address !== null));
  if (blocklist.has(sender)) return "blocked";

  const corpus = normalizeMatchText([message.from, message.replyTo, message.subject, message.bodyText].join("\n"));
  const categories = [
    ["priority", terms.priority],
    ["review", terms.review],
    ["new_contest", terms.newContest],
  ] as const;
  for (const [outcome, configuredTerms] of categories) {
    if (normalizeTerms(configuredTerms).some((term) => termMatches(corpus, term))) return outcome;
  }
  return "unmatched";
}
