import { withOwner } from "@/src/server/auth/owner";
import { ReviewClientError } from "@/src/server/gmail/review-queue";
import { ReviewService } from "@/src/server/gmail/review-service";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

type RouteContext = Readonly<{
  params: Promise<{ messageId: string }>;
}>;

export async function handleReviewSubmitPost(
  request: Request,
  context: RouteContext,
  service?: ReviewService,
): Promise<Response> {
  try {
    requireSameOrigin(request);
    return await withOwner(async (owner) => {
      const reviewService = service ?? new ReviewService();
      const { messageId: rawMessageId } = await context.params;
      const messageId = decodeURIComponent(rawMessageId ?? "").trim();
      if (!messageId) {
        return Response.json({ error: "messageId is required." }, { status: 400 });
      }
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") {
        return Response.json({ error: "Request body must be JSON with ownerLabel." }, { status: 400 });
      }
      const record = body as Record<string, unknown>;
      try {
        const result = await reviewService.submitOwnerLabel(owner.userId, messageId, record.ownerLabel);
        return Response.json(result);
      } catch (caught) {
        if (caught instanceof ReviewClientError) {
          return Response.json({ error: caught.message }, { status: 400 });
        }
        throw caught;
      }
    });
  } catch {
    return sanitizedErrorResponse();
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleReviewSubmitPost(request, context);
}
