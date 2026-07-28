import type { ClassificationOutcome } from "./classify";
import type { ParsedMessage } from "./message";
import { encryptSecret, decryptSecret } from "@/src/server/security/crypto";

/** Neutral parsed fields persisted for audit/eval. Never includes the match corpus. */
export type MessageSnapshotPlaintext = Readonly<{
  subject: string;
  from: string;
  replyTo: string;
  bodyText: string;
}>;

export type MessageSnapshotInsert = Readonly<{
  ownerAuthUserId: string;
  runId: string;
  gmailMessageId: string;
  encryptedPayload: string;
  keyVersion: number;
}>;

export interface MessageSnapshotStore {
  insertSnapshot(row: MessageSnapshotInsert): Promise<void>;
}

const CURRENT_KEY_VERSION = 1;

/**
 * Protected mail is never snapshotted (ADR-0012). Failed rows have no reliable
 * parsed text. Match corpus is never a candidate for persistence.
 */
export function shouldPersistMessageSnapshot(
  outcome: ClassificationOutcome | "failed",
): boolean {
  return outcome !== "protected" && outcome !== "failed";
}

export function messageSnapshotPlaintext(
  parsed: ParsedMessage,
): MessageSnapshotPlaintext {
  return {
    subject: parsed.subject,
    from: parsed.from,
    replyTo: parsed.replyTo,
    bodyText: parsed.bodyText,
  };
}

export function encryptMessageSnapshotPayload(
  plaintext: MessageSnapshotPlaintext,
  encryptionKey: string,
): string {
  return encryptSecret(JSON.stringify(plaintext), encryptionKey);
}

export function decryptMessageSnapshotPayload(
  ciphertext: string,
  encryptionKey: string,
): MessageSnapshotPlaintext {
  const parsed = JSON.parse(decryptSecret(ciphertext, encryptionKey)) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid message snapshot payload");
  }
  const record = parsed as Record<string, unknown>;
  for (const key of ["subject", "from", "replyTo", "bodyText"] as const) {
    if (typeof record[key] !== "string") {
      throw new Error("Invalid message snapshot payload");
    }
  }
  return {
    subject: record.subject as string,
    from: record.from as string,
    replyTo: record.replyTo as string,
    bodyText: record.bodyText as string,
  };
}

export async function persistMessageSnapshotIfEligible(input: {
  outcome: ClassificationOutcome | "failed";
  parsed: ParsedMessage;
  ownerAuthUserId: string;
  runId: string;
  encryptionKey: string;
  store: MessageSnapshotStore;
  keyVersion?: number;
}): Promise<boolean> {
  if (!shouldPersistMessageSnapshot(input.outcome)) return false;
  const plaintext = messageSnapshotPlaintext(input.parsed);
  await input.store.insertSnapshot({
    ownerAuthUserId: input.ownerAuthUserId,
    runId: input.runId,
    gmailMessageId: input.parsed.id,
    encryptedPayload: encryptMessageSnapshotPayload(plaintext, input.encryptionKey),
    keyVersion: input.keyVersion ?? CURRENT_KEY_VERSION,
  });
  return true;
}
