import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";
import { isDemoProfile } from "@/src/server/demo/ai-gate";
import { DEMO_RESET_COPY } from "@/src/server/demo/session-token";
import { clearDemoSessionCookieAndData } from "@/src/server/demo/session";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!isDemoProfile()) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    requireSameOrigin(request);
    await clearDemoSessionCookieAndData();
    return Response.json({ ok: true, message: DEMO_RESET_COPY }, { status: 200 });
  } catch {
    return sanitizedErrorResponse();
  }
}
