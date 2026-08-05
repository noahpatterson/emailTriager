import { requireOwner } from "@/src/server/auth/owner";
import { AuditRunService } from "@/src/server/gmail/audit-run";
import { sanitizedErrorResponse } from "@/src/server/security/request";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const owner = await requireOwner();
    const { id } = await context.params;
    const status = await new AuditRunService().getStatus(owner.userId, id);
    if (!status) {
      return Response.json({ error: "Audit run not found" }, { status: 404 });
    }
    return Response.json({
      id: status.id,
      syncRunId: status.syncRunId,
      status: status.status,
      processedCount: status.processedCount,
      totalEligible: status.totalEligible,
      nextCursor: status.nextCursor,
      modelProvider: status.modelProvider,
      modelName: status.modelName,
      promptVersionId: status.promptVersionId,
      errorSummary: status.errorSummary,
      startedAt: status.startedAt.toISOString(),
      finishedAt: status.finishedAt?.toISOString() ?? null,
    });
  } catch {
    return sanitizedErrorResponse();
  }
}
