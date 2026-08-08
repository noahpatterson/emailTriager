import { withOwner } from "@/src/server/auth/owner";
import { DemotionService } from "@/src/server/gmail/demotion-service";
import { sanitizedErrorResponse } from "@/src/server/security/request";

export async function handleDemotionQueueGet(
  _request: Request,
  service?: DemotionService,
): Promise<Response> {
  try {
    return await withOwner(async (owner) => {
      const demotionService = service ?? new DemotionService();
      const queue = await demotionService.getQueue(owner.userId);
      return Response.json(queue);
    });
  } catch {
    return sanitizedErrorResponse();
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleDemotionQueueGet(request);
}
