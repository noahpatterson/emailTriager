import "server-only";
import { eq, sql } from "drizzle-orm";
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
    // Raw upsert: demo migrations drop singleton; Drizzle schema still models prod.
    await this.db.execute(sql`
      INSERT INTO owner_binding (auth_user_id, gmail_message_link_root)
      VALUES (${ownerId}, ${normalized})
      ON CONFLICT (auth_user_id) DO UPDATE
      SET gmail_message_link_root = EXCLUDED.gmail_message_link_root
    `);
    return normalized;
  }
}
