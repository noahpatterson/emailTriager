import { requireOwner } from "@/src/server/auth/owner";
import { demoAiDisabledHttpResponse, isDemoAiDisabled } from "@/src/server/demo/ai-gate";
import { DemotionService } from "@/src/server/gmail/demotion-service";
import { sanitizedErrorResponse } from "@/src/server/security/request";

export async function handleDemotionQueueGet(
  _request: Request,
  service?: DemotionService,
): Promise<Response> {
  try {
    if (isDemoAiDisabled()) return demoAiDisabledHttpResponse();
    const demotionService = service ?? new DemotionService();
    const owner = await requireOwner();
    const queue = await demotionService.getQueue(owner.userId);
    return Response.json(queue);
  } catch {
    return sanitizedErrorResponse();
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleDemotionQueueGet(request);
}
