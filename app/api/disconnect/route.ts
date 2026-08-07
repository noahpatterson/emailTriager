import { withOwner } from "@/src/server/auth/owner";
import { DisconnectService } from "@/src/server/gmail/disconnect";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    return await withOwner(async (owner) => {
      await new DisconnectService().disconnect(owner.userId);
      return new Response(null, { status: 204 });
    });
  } catch {
    return sanitizedErrorResponse();
  }
}
