import "server-only";
import { eq } from "drizzle-orm";
import { ownerBinding } from "@/db/schema";
import { database, type Database } from "@/src/server/db";
import {
  DEFAULT_GMAIL_MESSAGE_LINK_ROOT,
  normalizeGmailMessageLinkRoot,
} from "@/src/server/config/owner-preferences-validate";

export {
  DEFAULT_GMAIL_MESSAGE_LINK_ROOT,
  normalizeGmailMessageLinkRoot,
} from "@/src/server/config/owner-preferences-validate";

export class OwnerPreferencesService {
  constructor(private readonly db: Database = database()) {}

  async getGmailMessageLinkRoot(ownerId: string): Promise<string> {
    const [row] = await this.db
      .select({ gmailMessageLinkRoot: ownerBinding.gmailMessageLinkRoot })
      .from(ownerBinding)
      .where(eq(ownerBinding.authUserId, ownerId))
      .limit(1);
    return row?.gmailMessageLinkRoot ?? DEFAULT_GMAIL_MESSAGE_LINK_ROOT;
  }

  async setGmailMessageLinkRoot(ownerId: string, value: string): Promise<string> {
    const normalized = normalizeGmailMessageLinkRoot(value);
    const [existing] = await this.db
      .select({ authUserId: ownerBinding.authUserId })
      .from(ownerBinding)
      .where(eq(ownerBinding.authUserId, ownerId))
      .limit(1);
    if (!existing) {
      await this.db.insert(ownerBinding).values({
        authUserId: ownerId,
        gmailMessageLinkRoot: normalized,
      });
      return normalized;
    }
    await this.db
      .update(ownerBinding)
      .set({ gmailMessageLinkRoot: normalized })
      .where(eq(ownerBinding.authUserId, ownerId));
    return normalized;
  }
}
