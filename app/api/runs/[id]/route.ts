import { withOwner } from "@/src/server/auth/owner";
import { DeleteRunService } from "@/src/server/gmail/delete-run";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    return await withOwner(async (owner) => {
      const { id } = await context.params;
      if (!id) return sanitizedErrorResponse(404);
      const result = await new DeleteRunService().delete(owner.userId, id);
      if (result === "not_found") return sanitizedErrorResponse(404);
      return new Response(null, { status: 204 });
    });
  } catch {
    return sanitizedErrorResponse();
  }
}
