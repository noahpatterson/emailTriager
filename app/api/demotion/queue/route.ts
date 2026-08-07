import { requireOwner } from "@/src/server/auth/owner";
import { DemotionService } from "@/src/server/gmail/demotion-service";
import { sanitizedErrorResponse } from "@/src/server/security/request";

export async function handleDemotionQueueGet(
  _request: Request,
  service: DemotionService = new DemotionService(),
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
  return handleDemotionQueueGet(request);
}
