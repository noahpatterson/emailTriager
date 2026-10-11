import { withOwner } from "@/src/server/auth/owner";
import { usesFixtureGmailProvider } from "@/src/server/gmail/app-profile";
import { ContestClientError, ContestScanService, contestCorrectionSchema } from "@/src/server/gmail/contest-scan";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";
type OwnerScope = (run: (owner: { userId: string }) => Promise<Response>) => Promise<Response>;
type RouteContext = Readonly<{ params: Promise<{ messageId: string }> }>;
export async function handleContestPatch(request: Request, context: RouteContext, service?: Pick<ContestScanService, "correct">, ownerScope: OwnerScope = withOwner): Promise<Response> {
  try {
    requireSameOrigin(request);
    return await ownerScope(async (owner) => {
      if (usesFixtureGmailProvider()) return Response.json({ error: "contest_disabled" }, { status: 403 });
      const { messageId } = await context.params;
      const parsed = contestCorrectionSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success || !messageId?.trim() || messageId.length > 200) return Response.json({ error: "invalid_correction" }, { status: 400 });
      try { return Response.json(await (service ?? new ContestScanService()).correct(owner.userId, messageId, parsed.data.category)); }
      catch (error) {
        if (error instanceof ContestClientError) return Response.json({ error: error.code }, { status: error.status });
        throw error;
      }
    });
  } catch { return sanitizedErrorResponse(); }
}
export async function PATCH(request: Request, context: RouteContext): Promise<Response> { return handleContestPatch(request, context); }
