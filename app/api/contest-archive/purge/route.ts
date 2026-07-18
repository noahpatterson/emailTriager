import { requireOwner } from "@/src/server/auth/owner";
import { googleProviderForOwner } from "@/src/server/gmail/factory";
import {
  CONTEST_ARCHIVE_PURGE_CONFIRM,
  ContestArchivePurgeService,
} from "@/src/server/gmail/contest-archive-purge";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const owner = await requireOwner();
    const body = await request.json() as { confirm?: unknown; pageToken?: unknown };
    if (body.confirm !== CONTEST_ARCHIVE_PURGE_CONFIRM) {
      return Response.json({ error: "Confirmation required" }, { status: 400 });
    }
    const pageToken = typeof body.pageToken === "string" && body.pageToken ? body.pageToken : null;
    try {
      const result = await new ContestArchivePurgeService(googleProviderForOwner).purge(owner.userId, {
        confirm: CONTEST_ARCHIVE_PURGE_CONFIRM,
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
  } catch {
    return sanitizedErrorResponse();
  }
}
