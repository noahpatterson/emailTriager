import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";
import { clientIpFromHeaders } from "@/src/server/security/allowed-ips";
import { establishDemoSession } from "@/src/server/demo/session";
import { isDemoProfile } from "@/src/server/demo/ai-gate";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!isDemoProfile()) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    requireSameOrigin(request);
    const ip = clientIpFromHeaders(request.headers);
    try {
      const { ownerId } = await establishDemoSession(ip);
      return Response.json({ ok: true, ownerId }, { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start demo";
      if (message.includes("rate limit")) {
        return Response.json({ error: message }, { status: 429 });
      }
      throw error;
    }
  } catch {
    return sanitizedErrorResponse();
  }
}
