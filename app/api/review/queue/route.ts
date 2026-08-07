import { requireOwner } from "@/src/server/auth/owner";
import { demoAiDisabledHttpResponse, isDemoAiDisabled } from "@/src/server/demo/ai-gate";
import { ReviewService } from "@/src/server/gmail/review-service";
import { sanitizedErrorResponse } from "@/src/server/security/request";

export async function handleReviewQueueGet(
  _request: Request,
  service?: ReviewService,
): Promise<Response> {
  try {
    if (isDemoAiDisabled()) return demoAiDisabledHttpResponse();
    const reviewService = service ?? new ReviewService();
    const owner = await requireOwner();
    const queue = await reviewService.getQueue(owner.userId);
    return Response.json(queue);
  } catch {
    return sanitizedErrorResponse();
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleReviewQueueGet(request);
}
