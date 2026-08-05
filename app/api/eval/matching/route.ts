import { requireOwner } from "@/src/server/auth/owner";
import { asBounds, asTerms } from "@/src/server/config/triage-validate";
import { MatchingEvalService } from "@/src/server/gmail/matching-eval-service";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const owner = await requireOwner();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json({ error: "Request body must be JSON with terms." }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    const terms = asTerms(record.terms);
    const bounds = record.bounds === undefined ? undefined : asBounds(record.bounds);
    try {
      const result = await new MatchingEvalService().run(owner.userId, terms, { bounds });
      return Response.json({
        id: result.id,
        type: "matching",
        candidate: result.candidate,
        metrics: result.metrics,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      if (
        message.includes("classification term")
        || message.includes("Too many")
        || message.includes("Owner binding")
        || message.includes("Golden Set")
      ) {
        return Response.json({ error: message }, { status: 400 });
      }
      throw caught;
    }
  } catch {
    return sanitizedErrorResponse();
  }
}
