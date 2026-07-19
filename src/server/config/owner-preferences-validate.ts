export const DEFAULT_GMAIL_MESSAGE_LINK_ROOT = "https://mail.google.com/mail/u/0/";

const GMAIL_MESSAGE_LINK_ROOT_PATTERN = /^https:\/\/mail\.google\.com\/mail\/u\/\d+\/?$/;

export function normalizeGmailMessageLinkRoot(value: string): string {
  const trimmed = value.trim();
  if (!GMAIL_MESSAGE_LINK_ROOT_PATTERN.test(trimmed)) {
    throw new Error(
      "Gmail message link root must look like https://mail.google.com/mail/u/0/",
    );
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}
