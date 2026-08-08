import { withOwner } from "@/src/server/auth/owner";
import { database } from "@/src/server/db";
import { isDemoProfile } from "@/src/server/demo/ai-gate";
import { consumeDemoSyncLimit } from "@/src/server/demo/limiters";
import { googleProviderForOwner } from "@/src/server/gmail/factory";
import { MessageSyncService } from "@/src/server/gmail/sync";
import { clientIpFromHeaders } from "@/src/server/security/allowed-ips";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

type SyncBody = Readonly<{ trial?: unknown; pageToken?: unknown }>;

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (isDemoProfile()) {
      const ip = clientIpFromHeaders(request.headers)?.trim() || "unknown";
      if (!(await consumeDemoSyncLimit(ip)).allowed) {
        return Response.json(
          { error: "Demo sync rate limit exceeded. Try again shortly." },
          { status: 429 },
        );
      }
    }
    return await withOwner(async (owner) => {
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
        pageToken,
      });
      return Response.json(result, { status: 202 });
    });
  } catch {
    return sanitizedErrorResponse();
  }
}
