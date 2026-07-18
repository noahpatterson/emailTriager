export type GmailPayload = Readonly<{
  mimeType?: string;
  headers?: readonly Readonly<{ name?: string; value?: string }>[];
  body?: Readonly<{ data?: string; size?: number }>;
  parts?: readonly GmailPayload[];
  filename?: string;
}>;

export type GmailMessage = Readonly<{
  id: string;
  threadId: string;
  labelIds?: readonly string[];
  internalDate?: string;
  payload?: GmailPayload;
}>;

export type ParsedMessage = Readonly<{
  id: string;
  threadId: string;
  internalDate: Date | null;
  labelIds: readonly string[];
  from: string;
  replyTo: string;
  subject: string;
  bodyText: string;
}>;

/** Gmail system label applied when the owner stars a message. */
export const GMAIL_STARRED_LABEL = "STARRED";

export function isGmailStarred(labelIds: readonly string[]): boolean {
  return labelIds.includes(GMAIL_STARRED_LABEL);
}

/** Read labelIds from a raw Gmail message payload without requiring a full MIME parse. */
export function labelIdsFromGmailMessage(raw: unknown): readonly string[] {
  if (!raw || typeof raw !== "object") return [];
  const labelIds = (raw as { labelIds?: unknown }).labelIds;
  if (!Array.isArray(labelIds)) return [];
  return labelIds.filter((id): id is string => typeof id === "string");
}

const MAX_PARTS = 100;
const MAX_DEPTH = 12;
const MAX_PART_BYTES = 256_000;
const MAX_MESSAGE_BYTES = 1_000_000;

function decodeBase64Url(data: string): Buffer {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(data)) throw new Error("Invalid MIME encoding");
  const bytes = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (bytes.byteLength > MAX_PART_BYTES) throw new Error("MIME part exceeds limit");
  return bytes;
}

function charsetFromMimeType(mimeType: string | undefined): string {
  const match = mimeType?.match(/;\s*charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/iu);
  return (match?.[1] ?? match?.[2] ?? "utf-8").trim();
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset, { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Invalid or unsupported MIME charset: ${charset}`);
  }
}

function decodeQuotedPrintableWord(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "_") {
      bytes.push(0x20);
    } else if (character === "=" && /^[0-9A-Fa-f]{2}$/u.test(value.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(character.charCodeAt(0));
    }
  }
  return Uint8Array.from(bytes);
}

function decodeMimeHeader(value: string): string {
  const unfolded = value.replace(/\r?\n[ \t]+/gu, " ");
  return unfolded.replace(
    /=\?([^?]+)\?([bq])\?([^?]*)\?=/giu,
    (_word, charset: string, encoding: string, encoded: string) => {
      const bytes = encoding.toLowerCase() === "b"
        ? Buffer.from(encoded, "base64")
        : decodeQuotedPrintableWord(encoded);
      return decodeBytes(bytes, charset);
    },
  );
}

function visibleHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"").replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

export function parseGmailMessage(message: GmailMessage): ParsedMessage {
  if (!message.id || !message.threadId || !message.payload) throw new Error("Malformed Gmail message");
  let parts = 0;
  let bytes = 0;
  const plain: string[] = [];
  const html: string[] = [];
  const visit = (part: GmailPayload, depth: number): void => {
    parts += 1;
    if (depth > MAX_DEPTH || parts > MAX_PARTS) throw new Error("MIME structure exceeds limit");
    if (part.body?.data && !part.filename) {
      const raw = decodeBase64Url(part.body.data);
      bytes += raw.byteLength;
      if (bytes > MAX_MESSAGE_BYTES) throw new Error("Message exceeds limit");
      const mime = part.mimeType?.toLowerCase().split(";", 1)[0];
      const decoded = decodeBytes(raw, charsetFromMimeType(part.mimeType));
      if (mime === "text/plain") plain.push(decoded);
      else if (mime === "text/html") html.push(visibleHtml(decoded));
    }
    for (const child of part.parts ?? []) visit(child, depth + 1);
  };
  visit(message.payload, 0);
  const headers = new Map((message.payload.headers ?? []).map((header) => [header.name?.toLowerCase() ?? "", header.value ?? ""]));
  const timestamp = message.internalDate && /^\d+$/.test(message.internalDate) ? Number(message.internalDate) : Number.NaN;
  return {
    id: message.id,
    threadId: message.threadId,
    internalDate: Number.isFinite(timestamp) ? new Date(timestamp) : null,
    labelIds: message.labelIds ?? [],
    from: decodeMimeHeader(headers.get("from") ?? ""),
    replyTo: decodeMimeHeader(headers.get("reply-to") ?? ""),
    subject: decodeMimeHeader(headers.get("subject") ?? ""),
    bodyText: (plain.length ? plain : html).join("\n").trim(),
  };
}
