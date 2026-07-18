import { requireOwner } from "@/src/server/auth/owner";
import { database } from "@/src/server/db";
import { googleProviderForOwner } from "@/src/server/gmail/factory";
import { MessageSyncService } from "@/src/server/gmail/sync";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

type SyncBody = Readonly<{ trial?: unknown; pageToken?: unknown }>;

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const owner = await requireOwner();
    let body: SyncBody = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const parsed = await request.json().catch(() => null);
      if (parsed && typeof parsed === "object") body = parsed as SyncBody;
    }
    const trial = body.trial === true;
    const pageToken = typeof body.pageToken === "string" && body.pageToken.length > 0 ? body.pageToken : null;
    const result = await new MessageSyncService(googleProviderForOwner, database()).start(owner.userId, {
      trial,
      pageToken: trial ? pageToken : null,
    });
    return Response.json(result, { status: 202 });
  } catch {
    return sanitizedErrorResponse();
  }
}
