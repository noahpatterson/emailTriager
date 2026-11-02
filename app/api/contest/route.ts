import { withOwner } from "@/src/server/auth/owner";
import { usesFixtureGmailProvider } from "@/src/server/gmail/app-profile";
import { ContestClientError, ContestScanService, contestActionSchema } from "@/src/server/gmail/contest-scan";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";
import { getPersonalDeploymentPolicy } from "@/src/config/deployment-policy";

export const maxDuration = 300;

type OwnerScope = (run: (owner: { userId: string }) => Promise<Response>) => Promise<Response>;
type ContestApiService = Pick<ContestScanService, "overview" | "configure" | "scan">;
export async function handleContestGet(service?: ContestApiService, ownerScope: OwnerScope = withOwner): Promise<Response> {
  try {
    return await ownerScope(async (owner) => {
      if (usesFixtureGmailProvider()) return Response.json({ settings: null, results: [], latestRun: null, modelConfigured: false, notificationsConfigured: false, disabled: true });
      return Response.json(await (service ?? new ContestScanService()).overview(owner.userId));
    });
  } catch { return sanitizedErrorResponse(); }
}
export async function handleContestPost(request: Request, service?: ContestApiService, ownerScope: OwnerScope = withOwner): Promise<Response> {
  try {
    requireSameOrigin(request);
    return await ownerScope(async (owner) => {
      if (usesFixtureGmailProvider()) return Response.json({ error: "contest_disabled" }, { status: 403 });
      const parsed = contestActionSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
      const policy = getPersonalDeploymentPolicy();
      if (parsed.data.action === "scan" && policy) {
        if (!policy.externalAiEnabled) return Response.json({ error: "external_ai_disabled" }, { status: 403 });
        if (!parsed.data.trial && !policy.gmailWritesEnabled) return Response.json({ error: "gmail_writes_disabled" }, { status: 403 });
      }
      const active = service ?? new ContestScanService();
      try {
        return Response.json(parsed.data.action === "configure"
          ? await active.configure(owner.userId, parsed.data.labels)
          : await active.scan(owner.userId, parsed.data));
      } catch (error) {
        if (error instanceof ContestClientError) return Response.json({ error: error.code }, { status: error.status });
        throw error;
      }
    });
  } catch { return sanitizedErrorResponse(); }
}
export async function GET(): Promise<Response> { return handleContestGet(); }
export async function POST(request: Request): Promise<Response> { return handleContestPost(request); }
