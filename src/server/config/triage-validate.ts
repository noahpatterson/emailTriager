import {
  normalizeTerms,
  parseMailboxAddress,
  type ClassificationTerms,
} from "@/src/server/gmail/classify";
import type { SyncBounds } from "@/src/server/gmail/sync";

const FORBIDDEN_LABELS = new Set(["TRASH", "SPAM", "UNREAD"]);
const MAX_SENDER_LIST = 200;

export type TriageConfigInput = Readonly<{
  sourceLabelId: string;
  priorityLabelId: string;
  reviewLabelId: string;
  contestLabelId: string;
  contestArchiveLabelId: string;
  terms: ClassificationTerms;
  senderWhitelist: readonly string[];
  senderBlocklist: readonly string[];
  bounds: SyncBounds;
}>;

export type TriageConfigView = TriageConfigInput & Readonly<{ version: number }>;

export const DEFAULT_TRIAGE_CONFIG: TriageConfigInput = {
  sourceLabelId: "",
  priorityLabelId: "",
  reviewLabelId: "",
  contestLabelId: "",
  contestArchiveLabelId: "",
  terms: { priority: [], review: [], newContest: [] },
  senderWhitelist: [],
  senderBlocklist: [],
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
  contestLabelId: string;
  contestArchiveLabelId: string;
}>): void {
  const values = [
    labels.sourceLabelId.trim(),
    labels.priorityLabelId.trim(),
    labels.reviewLabelId.trim(),
    labels.contestLabelId.trim(),
    labels.contestArchiveLabelId.trim(),
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

export function normalizeTriageConfig(input: TriageConfigInput): TriageConfigInput {
  validateLabelIds(input);
  return {
    sourceLabelId: input.sourceLabelId.trim(),
    priorityLabelId: input.priorityLabelId.trim(),
    reviewLabelId: input.reviewLabelId.trim(),
    contestLabelId: input.contestLabelId.trim(),
    contestArchiveLabelId: input.contestArchiveLabelId.trim(),
    terms: {
      priority: normalizeTerms(input.terms.priority),
      review: normalizeTerms(input.terms.review),
      newContest: normalizeTerms(input.terms.newContest),
    },
    senderWhitelist: validateSenderWhitelist(input.senderWhitelist),
    senderBlocklist: validateSenderBlocklist(input.senderBlocklist),
    bounds: validateBounds(input.bounds),
  };
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function asTerms(value: unknown): ClassificationTerms {
  if (!value || typeof value !== "object") return { priority: [], review: [], newContest: [] };
  const record = value as Record<string, unknown>;
  return {
    priority: asStringArray(record.priority),
    review: asStringArray(record.review),
    newContest: asStringArray(record.newContest),
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
