import { requireOwner } from "@/src/server/auth/owner";
import {
  AuditAlreadyRunningError,
  AuditClientError,
  AuditRunService,
} from "@/src/server/gmail/audit-run";
import { DEFAULT_AUDIT_MAX_MESSAGES } from "@/src/server/gmail/audit-batch";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

function parseMaxMessages(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw new AuditClientError("maxMessages must be an integer.");
  }
  if (raw < 1 || raw > DEFAULT_AUDIT_MAX_MESSAGES) {
    throw new AuditClientError(`maxMessages must be between 1 and ${DEFAULT_AUDIT_MAX_MESSAGES}.`);
  }
  return raw;
}

export async function handleAuditPost(
  request: Request,
  service: AuditRunService = new AuditRunService(),
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const owner = await requireOwner();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json({ error: "Request body must be JSON with syncRunId." }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    const syncRunId = typeof record.syncRunId === "string" ? record.syncRunId.trim() : "";
    if (!syncRunId) {
      return Response.json({ error: "syncRunId is required." }, { status: 400 });
    }
    const auditRunId = typeof record.auditRunId === "string" ? record.auditRunId.trim() : undefined;
    try {
      const maxMessages = parseMaxMessages(record.maxMessages);
      // Work is synchronous and bounded; 200 reflects completion of this invocation
      // (not a background accept). Resume via another POST with auditRunId / nextCursor.
      const result = await service.start(owner.userId, {
        syncRunId,
        auditRunId: auditRunId || undefined,
        maxMessages,
      });
      return Response.json(result, { status: 200 });
    } catch (caught) {
      if (caught instanceof AuditAlreadyRunningError || caught instanceof AuditClientError) {
        return Response.json({ error: caught.message }, { status: 400 });
      }
      throw caught;
    }
  } catch {
    return sanitizedErrorResponse();
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleAuditPost(request);
}
