export type GmailLabel = Readonly<{ id: string; name: string }>;

export type LabelRefs = Readonly<{
  sourceLabelId: string;
  priorityLabelId: string;
  reviewLabelId: string;
  newLabelId: string;
  archiveLabelId: string;
}>;

const FORBIDDEN_LABELS = new Set(["TRASH", "SPAM", "UNREAD"]);

function normalizeLabelKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("und");
}

/** Resolve a user-entered Gmail label name or id against the account catalog. */
export function resolveLabelRef(value: string, catalog: readonly GmailLabel[]): GmailLabel {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Label is required");
  if (FORBIDDEN_LABELS.has(trimmed.toUpperCase())) throw new Error(`Label "${trimmed}" is not allowed`);

  const byId = catalog.find((label) => label.id === trimmed);
  if (byId) {
    if (FORBIDDEN_LABELS.has(byId.id.toUpperCase()) || FORBIDDEN_LABELS.has(byId.name.toUpperCase())) {
      throw new Error(`Label "${trimmed}" is not allowed`);
    }
    return byId;
  }

  const key = normalizeLabelKey(trimmed);
  const matches = catalog.filter((label) => normalizeLabelKey(label.name) === key);
  if (matches.length === 1) {
    const match = matches[0]!;
    if (FORBIDDEN_LABELS.has(match.id.toUpperCase()) || FORBIDDEN_LABELS.has(match.name.toUpperCase())) {
      throw new Error(`Label "${trimmed}" is not allowed`);
    }
    return match;
  }
  if (matches.length > 1) throw new Error(`Label "${trimmed}" matches more than one Gmail label`);
  throw new Error(`Gmail label "${trimmed}" was not found`);
}

export function resolveLabelRefs(refs: LabelRefs, catalog: readonly GmailLabel[]): LabelRefs {
  const source = resolveLabelRef(refs.sourceLabelId, catalog);
  const priority = resolveLabelRef(refs.priorityLabelId, catalog);
  const review = resolveLabelRef(refs.reviewLabelId, catalog);
  const newLabel = resolveLabelRef(refs.newLabelId, catalog);
  const archive = resolveLabelRef(refs.archiveLabelId, catalog);
  const ids = [source.id, priority.id, review.id, newLabel.id, archive.id];
  if (new Set(ids).size !== ids.length) throw new Error("Source and destination labels must be distinct");
  return {
    sourceLabelId: source.id,
    priorityLabelId: priority.id,
    reviewLabelId: review.id,
    newLabelId: newLabel.id,
    archiveLabelId: archive.id,
  };
}

/** Prefer display names for the configuration form when a catalog is available. */
export function displayLabelRefs(refs: LabelRefs, catalog: readonly GmailLabel[]): LabelRefs {
  const nameFor = (id: string): string => catalog.find((label) => label.id === id)?.name ?? id;
  return {
    sourceLabelId: nameFor(refs.sourceLabelId),
    priorityLabelId: nameFor(refs.priorityLabelId),
    reviewLabelId: nameFor(refs.reviewLabelId),
    newLabelId: nameFor(refs.newLabelId),
    archiveLabelId: nameFor(refs.archiveLabelId),
  };
}

export function displayLabelName(
  labelId: string | null,
  catalog: readonly GmailLabel[],
): string | null {
  if (!labelId) return null;
  return catalog.find((label) => label.id === labelId)?.name ?? labelId;
}
