import { withOwner } from "@/src/server/auth/owner";
import { googleProviderForOwner } from "@/src/server/gmail/factory";
import {
  ARCHIVE_PURGE_CONFIRM,
  ArchivePurgeService,
} from "@/src/server/gmail/archive-purge";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    return await withOwner(async (owner) => {
      const body = await request.json() as { confirm?: unknown; pageToken?: unknown };
      if (body.confirm !== ARCHIVE_PURGE_CONFIRM) {
        return Response.json({ error: "Confirmation required" }, { status: 400 });
      }
      const pageToken = typeof body.pageToken === "string" && body.pageToken ? body.pageToken : null;
      try {
        const result = await new ArchivePurgeService(googleProviderForOwner).purge(owner.userId, {
          confirm: ARCHIVE_PURGE_CONFIRM,
          pageToken,
        });
        return Response.json(result);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "";
        if (
          message.includes("Confirmation")
          || message.includes("Synchronization")
          || message.includes("archive")
          || message.includes("configured")
          || message.includes("label")
          || message.includes("Label")
          || message.includes("Gmail")
        ) {
          return Response.json({ error: message }, { status: 400 });
        }
        throw caught;
      }
    });
  } catch {
    return sanitizedErrorResponse();
  }
}
