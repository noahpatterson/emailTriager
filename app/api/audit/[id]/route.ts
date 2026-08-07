import { requireOwner } from "@/src/server/auth/owner";
import {
  AUDIT_ERROR_CODE_SET,
  AuditRunService,
} from "@/src/server/gmail/audit-run";
import { demoAiDisabledHttpResponse, isDemoAiDisabled } from "@/src/server/demo/ai-gate";
import { sanitizedErrorResponse } from "@/src/server/security/request";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function handleAuditGet(
  _request: Request,
  context: RouteContext,
  service?: AuditRunService,
): Promise<Response> {
  try {
    if (isDemoAiDisabled()) return demoAiDisabledHttpResponse();
    const auditService = service ?? new AuditRunService();
    const owner = await requireOwner();
    const { id } = await context.params;
    const status = await auditService.getStatus(owner.userId, id);
    if (!status) {
      return Response.json({ error: "Audit run not found" }, { status: 404 });
    }
    const errorCode = status.errorSummary && AUDIT_ERROR_CODE_SET.has(status.errorSummary)
      ? status.errorSummary
      : (status.errorSummary ? "audit_failed" : null);
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
      errorCode,
      startedAt: status.startedAt.toISOString(),
      finishedAt: status.finishedAt?.toISOString() ?? null,
    });
  } catch {
    return sanitizedErrorResponse();
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleAuditGet(request, context);
}
