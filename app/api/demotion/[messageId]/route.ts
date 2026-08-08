import { withOwner } from "@/src/server/auth/owner";
import { DemotionClientError, DemotionService } from "@/src/server/gmail/demotion-service";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

export async function handleDemotionConfirmPost(
  request: Request,
  messageId: string,
  service?: DemotionService,
): Promise<Response> {
  try {
    requireSameOrigin(request);
    return await withOwner(async (owner) => {
      const demotionService = service ?? new DemotionService();
      const decoded = messageId.trim();
      if (!decoded) {
        return Response.json({ error: "gmailMessageId is required" }, { status: 400 });
      }
      try {
        const result = await demotionService.confirmDemotion(owner.userId, decoded);
        return Response.json(result);
      } catch (caught) {
        if (caught instanceof DemotionClientError) {
          return Response.json({ error: caught.message }, { status: 400 });
        }
        throw caught;
      }
    });
  } catch {
    return sanitizedErrorResponse();
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ messageId: string }> },
): Promise<Response> {
  const { messageId } = await context.params;
  return handleDemotionConfirmPost(request, messageId);
}
