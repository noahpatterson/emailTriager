import { requireOwner } from "@/src/server/auth/owner";
import { parseReviewQueueMode } from "@/src/server/gmail/review-queue";
import { ReviewService } from "@/src/server/gmail/review-service";
import { sanitizedErrorResponse } from "@/src/server/security/request";

export async function handleReviewQueueGet(
  request: Request,
  service: ReviewService = new ReviewService(),
): Promise<Response> {
  try {
    const owner = await requireOwner();
    const url = new URL(request.url);
    const mode = parseReviewQueueMode(url.searchParams.get("mode"));
    const queue = await service.getQueue(owner.userId, { mode });
    return Response.json(queue);
  } catch {
    return sanitizedErrorResponse();
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleReviewQueueGet(request);
}
