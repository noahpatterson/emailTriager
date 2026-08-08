import { DEFAULT_GMAIL_MESSAGE_LINK_ROOT } from "@/src/server/config/owner-preferences-validate";
import { displayLabelRefs, type GmailLabel, type LabelRefs } from "@/src/server/gmail/labels";

export { DEFAULT_GMAIL_MESSAGE_LINK_ROOT };

function normalizeLinkRoot(linkRoot: string): string {
  const trimmed = linkRoot.trim();
  if (!trimmed) return DEFAULT_GMAIL_MESSAGE_LINK_ROOT;
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/**
 * Deep-link into Gmail web (All Mail) using the owner's configured message link root.
 * Prefers thread id; falls back to message id.
 */
export function gmailMessageUrl(
  row: Readonly<{ gmailMessageId: string; gmailThreadId: string | null }>,
  linkRoot: string = DEFAULT_GMAIL_MESSAGE_LINK_ROOT,
): string {
  const id = (row.gmailThreadId || row.gmailMessageId).trim();
  return `${normalizeLinkRoot(linkRoot)}#all/${encodeURIComponent(id)}`;
}

/** Thread-only variant — null when no thread id is available. */
export function gmailThreadUrl(
  threadId: string | null | undefined,
  linkRoot: string = DEFAULT_GMAIL_MESSAGE_LINK_ROOT,
): string | null {
  const id = threadId?.trim();
  if (!id) return null;
  return gmailMessageUrl({ gmailMessageId: id, gmailThreadId: id }, linkRoot);
}

/**
 * Deep-link to a Gmail label view. Uses the human label name (e.g. Triage/Priority),
 * not the opaque Label_N id.
 */
export function gmailLabelUrl(
  labelName: string,
  linkRoot: string = DEFAULT_GMAIL_MESSAGE_LINK_ROOT,
): string | null {
  const name = labelName.trim();
  if (!name) return null;
  return `${normalizeLinkRoot(linkRoot)}#label/${encodeURIComponent(name)}`;
}

export type GmailLabelJump = Readonly<{
  key: "source" | "priority" | "review" | "new" | "archive";
  title: string;
  name: string;
  href: string;
}>;

const JUMP_ORDER = [
  ["source", "Source", "sourceLabelId"],
  ["priority", "Priority", "priorityLabelId"],
  ["review", "Review", "reviewLabelId"],
  ["new", "New", "newLabelId"],
  ["archive", "Archive", "archiveLabelId"],
] as const;

/**
 * Build open-in-Gmail jumps for the five configured triage labels.
 * Requires a live catalog so Label_N ids resolve to names Gmail's #label/ URLs understand.
 */
export function buildGmailLabelJumps(
  refs: LabelRefs,
  linkRoot: string,
  catalog: readonly GmailLabel[],
): readonly GmailLabelJump[] {
  if (catalog.length === 0) return [];
  const names = displayLabelRefs(refs, catalog);
  const jumps: GmailLabelJump[] = [];
  for (const [key, title, field] of JUMP_ORDER) {
    const name = names[field].trim();
    // Skip unresolved opaque ids — Gmail won't open Label_12 as a label view.
    if (!name || /^Label_\d+$/u.test(name)) continue;
    const href = gmailLabelUrl(name, linkRoot);
    if (!href) continue;
    jumps.push({ key, title, name, href });
  }
  return jumps;
}
