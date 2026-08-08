import { requireOwner } from "@/src/server/auth/owner";
import { isDemoProfile } from "@/src/server/demo/ai-gate";
import { GoogleConnectionService } from "@/src/server/oauth/google";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (isDemoProfile()) {
      return Response.json(
        { error: "Google OAuth is disabled in the public demo. The fixture mailbox is already connected." },
        { status: 403 },
      );
    }
    const owner = await requireOwner();
    const result = await new GoogleConnectionService().begin(owner.userId);
    return Response.json(result);
  } catch (error) {
    console.error(
      "POST /api/oauth/google/start failed",
      error instanceof Error ? error.message : error,
    );
    return sanitizedErrorResponse();
  }
}
