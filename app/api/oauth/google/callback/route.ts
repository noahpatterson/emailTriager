import { requireOwner } from "@/src/server/auth/owner";
import { getServerConfig } from "@/src/config/server";
import { isDemoProfile } from "@/src/server/demo/ai-gate";
import { GoogleConnectionService } from "@/src/server/oauth/google";
import { publicAppUrl, sanitizedErrorResponse } from "@/src/server/security/request";

export async function GET(request: Request): Promise<Response> {
  try {
    if (isDemoProfile()) {
      return Response.json(
        { error: "Google OAuth is disabled in the public demo. The fixture mailbox is already connected." },
        { status: 403 },
      );
    }
    const owner = await requireOwner();
    const url = new URL(request.url);
    await new GoogleConnectionService().complete(
      owner.userId,
      url.searchParams.get("code") ?? "",
      url.searchParams.get("state") ?? "",
    );
    return Response.redirect(publicAppUrl(getServerConfig().googleRedirectUri, "/"));
  } catch (error) {
    console.error(
      "GET /api/oauth/google/callback failed",
      error instanceof Error ? error.message : error,
    );
    return sanitizedErrorResponse();
  }
}
