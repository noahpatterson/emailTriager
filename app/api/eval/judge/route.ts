import { requireOwner } from "@/src/server/auth/owner";
import { demoAiDisabledHttpResponse, isDemoAiDisabled } from "@/src/server/demo/ai-gate";
import {
  JudgeEvalClientError,
  JudgeEvalService,
} from "@/src/server/gmail/judge-eval-service";
import { JudgeTransportError } from "@/src/server/gmail/judge";
import { requireSameOrigin, sanitizedErrorResponse } from "@/src/server/security/request";

export async function handleJudgeEvalPost(
  request: Request,
  service?: JudgeEvalService,
): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (isDemoAiDisabled()) return demoAiDisabledHttpResponse();
    const judgeService = service ?? new JudgeEvalService();
    const owner = await requireOwner();
    try {
      const result = await judgeService.run(owner.userId);
      return Response.json({
        id: result.id,
        type: "judge",
        candidate: result.candidate,
        metrics: result.metrics,
        tags: result.tags,
      });
    } catch (caught) {
      if (caught instanceof JudgeEvalClientError) {
        return Response.json({ error: caught.message }, { status: 400 });
      }
      if (caught instanceof JudgeTransportError) {
        return Response.json({ error: "Judge call failed" }, { status: 502 });
      }
      throw caught;
    }
  } catch {
    return sanitizedErrorResponse();
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleJudgeEvalPost(request);
}
