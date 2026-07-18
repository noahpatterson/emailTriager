import { requireOwner } from "@/src/server/auth/owner";
import { GoogleConnectionService } from "@/src/server/oauth/google";
import { publicAppUrl, sanitizedErrorResponse } from "@/src/server/security/request";

export async function GET(request: Request): Promise<Response> {
  try {
    const owner = await requireOwner();
    const url = new URL(request.url);
    await new GoogleConnectionService().complete(
      owner.userId,
      url.searchParams.get("code") ?? "",
      url.searchParams.get("state") ?? "",
    );
    return Response.redirect(publicAppUrl(request, "/"));
  } catch (error) {
    console.error(
      "GET /api/oauth/google/callback failed",
      error instanceof Error ? error.message : error,
    );
    return sanitizedErrorResponse();
  }
}
