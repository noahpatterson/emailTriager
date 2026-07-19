import type { GmailProvider } from "./contracts";
import { isGmailStarred, labelIdsFromGmailMessage } from "./message";

/** Trash listed archive messages, skipping any that carry Gmail STARRED. */
export async function trashListedArchiveMessages(
  provider: GmailProvider,
  messageIds: readonly string[],
  archiveLabelId: string,
  assertMutationAllowed: () => Promise<void> = async () => {},
): Promise<Readonly<{ trashedCount: number; skippedStarredCount: number }>> {
  let trashedCount = 0;
  let skippedStarredCount = 0;
  for (const messageId of messageIds) {
    const labelIds = labelIdsFromGmailMessage(await provider.getMessage(messageId));
    if (isGmailStarred(labelIds)) {
      skippedStarredCount += 1;
      continue;
    }
    if (!labelIds.includes(archiveLabelId)) continue;
    await assertMutationAllowed();
    await provider.trashMessage(messageId);
    trashedCount += 1;
  }
  return { trashedCount, skippedStarredCount };
}
