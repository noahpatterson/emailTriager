import {
  normalizeTerms,
  parseMailboxAddress,
  type ClassificationTerms,
} from "@/src/server/gmail/classify";
import type { SyncBounds } from "@/src/server/gmail/sync";

const FORBIDDEN_LABELS = new Set(["TRASH", "SPAM", "UNREAD"]);
const MAX_SENDER_LIST = 200;
export const MAX_CATEGORY_INTENT_CHARS = 2000;

export const CATEGORY_INTENT_KEYS = ["priority", "review", "new", "archive"] as const;
export type CategoryIntentKey = (typeof CATEGORY_INTENT_KEYS)[number];

export type CategoryIntent = Readonly<{
  priority: string;
  review: string;
  new: string;
  archive: string;
}>;

export type TriageConfigInput = Readonly<{
  sourceLabelId: string;
  priorityLabelId: string;
  reviewLabelId: string;
  newLabelId: string;
  archiveLabelId: string;
  terms: ClassificationTerms;
  senderWhitelist: readonly string[];
  senderBlocklist: readonly string[];
  categoryIntent: CategoryIntent;
  bounds: SyncBounds;
}>;

export type TriageConfigView = TriageConfigInput & Readonly<{ version: number }>;

export const EMPTY_CATEGORY_INTENT: CategoryIntent = {
  priority: "",
  review: "",
  new: "",
  archive: "",
};

export const DEFAULT_TRIAGE_CONFIG: TriageConfigInput = {
  sourceLabelId: "",
  priorityLabelId: "",
  reviewLabelId: "",
  newLabelId: "",
  archiveLabelId: "",
  terms: { priority: [], review: [], new: [] },
  senderWhitelist: [],
  senderBlocklist: [],
  categoryIntent: EMPTY_CATEGORY_INTENT,
  bounds: { maxPages: 3, maxMessagesPerPage: 50, maxTotalMessages: 100 },
};

export function parseTermList(value: string): readonly string[] {
  return value
    .split(/[\n,]/u)
    .map((term) => term.trim())
    .filter(Boolean);
}

export function validateLabelIds(labels: Readonly<{
  sourceLabelId: string;
  priorityLabelId: string;
  reviewLabelId: string;
  newLabelId: string;
  archiveLabelId: string;
}>): void {
  const values = [
    labels.sourceLabelId.trim(),
    labels.priorityLabelId.trim(),
    labels.reviewLabelId.trim(),
    labels.newLabelId.trim(),
    labels.archiveLabelId.trim(),
  ];
  if (values.some((label) => !label || FORBIDDEN_LABELS.has(label.toUpperCase())) || new Set(values).size !== values.length) {
    throw new Error("Invalid label configuration");
  }
}

export function validateBounds(bounds: SyncBounds): SyncBounds {
  const { maxPages, maxMessagesPerPage, maxTotalMessages } = bounds;
  if (
    !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50
    || !Number.isInteger(maxMessagesPerPage) || maxMessagesPerPage < 1 || maxMessagesPerPage > 500
    || !Number.isInteger(maxTotalMessages) || maxTotalMessages < 1 || maxTotalMessages > 5000
  ) {
    throw new Error("Invalid sync bounds");
  }
  return { maxPages, maxMessagesPerPage, maxTotalMessages };
}

function validateSenderAddressList(addresses: readonly string[], kind: "whitelist" | "blocklist"): readonly string[] {
  if (addresses.length > MAX_SENDER_LIST) throw new Error(`Too many ${kind} addresses`);
  const normalized = addresses.map((address) => {
    const parsed = parseMailboxAddress(address.trim());
    if (!parsed) throw new Error(`Invalid ${kind} address`);
    return parsed;
  });
  return [...new Set(normalized)];
}

export function validateSenderWhitelist(addresses: readonly string[]): readonly string[] {
  return validateSenderAddressList(addresses, "whitelist");
}

export function validateSenderBlocklist(addresses: readonly string[]): readonly string[] {
  return validateSenderAddressList(addresses, "blocklist");
}

/** Normalize and bound-check intent prose. Empty strings are allowed on save; audit runs require completeness separately. */
export function validateCategoryIntent(intent: CategoryIntent): CategoryIntent {
  const normalized = {
    priority: intent.priority.trim(),
    review: intent.review.trim(),
    new: intent.new.trim(),
    archive: intent.archive.trim(),
  };
  for (const key of CATEGORY_INTENT_KEYS) {
    if (normalized[key].length > MAX_CATEGORY_INTENT_CHARS) {
      throw new Error(`Category intent for ${key} exceeds ${MAX_CATEGORY_INTENT_CHARS} characters`);
    }
  }
  return normalized;
}

/** True when every category has non-empty intent — required before starting an audit run. */
export function hasCompleteCategoryIntent(intent: CategoryIntent): boolean {
  return CATEGORY_INTENT_KEYS.every((key) => intent[key].trim().length > 0);
}

export function assertCompleteCategoryIntent(intent: CategoryIntent): void {
  if (!hasCompleteCategoryIntent(intent)) {
    throw new Error("Category intent is required for every category before starting an audit run");
  }
}

export function normalizeTriageConfig(input: TriageConfigInput): TriageConfigInput {
  validateLabelIds(input);
  return {
    sourceLabelId: input.sourceLabelId.trim(),
    priorityLabelId: input.priorityLabelId.trim(),
    reviewLabelId: input.reviewLabelId.trim(),
    newLabelId: input.newLabelId.trim(),
    archiveLabelId: input.archiveLabelId.trim(),
    terms: {
      priority: normalizeTerms(input.terms.priority),
      review: normalizeTerms(input.terms.review),
      new: normalizeTerms(input.terms.new),
    },
    senderWhitelist: validateSenderWhitelist(input.senderWhitelist),
    senderBlocklist: validateSenderBlocklist(input.senderBlocklist),
    categoryIntent: validateCategoryIntent(input.categoryIntent),
    bounds: validateBounds(input.bounds),
  };
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function asTerms(value: unknown): ClassificationTerms {
  if (!value || typeof value !== "object") return { priority: [], review: [], new: [] };
  const record = value as Record<string, unknown>;
  return {
    priority: asStringArray(record.priority),
    review: asStringArray(record.review),
    new: asStringArray(record.new ?? record.newContest),
  };
}

/** Migration default and missing-field fallback: empty strings for all categories. */
export function asCategoryIntent(value: unknown): CategoryIntent {
  if (!value || typeof value !== "object") return { ...EMPTY_CATEGORY_INTENT };
  const record = value as Record<string, unknown>;
  return {
    priority: typeof record.priority === "string" ? record.priority : "",
    review: typeof record.review === "string" ? record.review : "",
    new: typeof record.new === "string" ? record.new : "",
    archive: typeof record.archive === "string" ? record.archive : "",
  };
}

export function asBounds(value: unknown): SyncBounds {
  if (!value || typeof value !== "object") return DEFAULT_TRIAGE_CONFIG.bounds;
  const record = value as Record<string, unknown>;
  return {
    maxPages: typeof record.maxPages === "number" ? record.maxPages : DEFAULT_TRIAGE_CONFIG.bounds.maxPages,
    maxMessagesPerPage: typeof record.maxMessagesPerPage === "number" ? record.maxMessagesPerPage : DEFAULT_TRIAGE_CONFIG.bounds.maxMessagesPerPage,
    maxTotalMessages: typeof record.maxTotalMessages === "number" ? record.maxTotalMessages : DEFAULT_TRIAGE_CONFIG.bounds.maxTotalMessages,
  };
}
