import { requireOwner } from "@/src/server/auth/owner";
import { ReviewService } from "@/src/server/gmail/review-service";
import { sanitizedErrorResponse } from "@/src/server/security/request";

export async function handleReviewQueueGet(
  _request: Request,
  service: ReviewService = new ReviewService(),
): Promise<Response> {
  try {
    const owner = await requireOwner();
    const queue = await service.getQueue(owner.userId);
    return Response.json(queue);
  } catch {
    return sanitizedErrorResponse();
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleReviewQueueGet(request);
}
