import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { Category } from "@/src/server/gmail/corpus";

/** Zod stays at the model boundary only (ADR-0007). */
export const MAX_VERDICT_RATIONALE_CHARS = 500;
export const JUDGE_TIMEOUT_MS = 60_000;

export const verdictSchema = z.object({
  agrees_with_filing: z.boolean(),
  recommended_category: z.enum(["priority", "review", "new", "archive"]),
  rationale: z.string().max(MAX_VERDICT_RATIONALE_CHARS),
});

export type JudgeModelTags = Readonly<{
  model: string;
  provider: string;
  promptVersion: string;
}>;

export type JudgeVerdictResult = Readonly<{
  agreesWithFiling: boolean | null;
  recommendedCategory: Category | null;
  rationale: string | null;
  malformed: boolean;
  model: string;
  provider: string;
  promptVersion: string;
}>;

/** Transport / auth / timeout failures — not schema malformation. */
export class JudgeTransportError extends Error {
  readonly code = "judge_transport" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JudgeTransportError";
  }
}

function malformedResult(tags: JudgeModelTags): JudgeVerdictResult {
  return {
    agreesWithFiling: null,
    recommendedCategory: null,
    rationale: null,
    malformed: true,
    model: tags.model,
    provider: tags.provider,
    promptVersion: tags.promptVersion,
  };
}

export async function judgeMessage(input: Readonly<{
  model: LanguageModel;
  system: string;
  user: string;
  tags: JudgeModelTags;
}>): Promise<JudgeVerdictResult> {
  const tags = {
    model: input.tags.model,
    provider: input.tags.provider,
    promptVersion: input.tags.promptVersion,
  };
  try {
    const result = await generateText({
      model: input.model,
      system: input.system,
      prompt: input.user,
      output: Output.object({ schema: verdictSchema }),
      abortSignal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
    const object = result.output;
    if (!object) return malformedResult(tags);
    return {
      agreesWithFiling: object.agrees_with_filing,
      recommendedCategory: object.recommended_category,
      rationale: object.rationale,
      malformed: false,
      ...tags,
    };
  } catch (caught) {
    if (NoObjectGeneratedError.isInstance(caught)) {
      return malformedResult(tags);
    }
    throw new JudgeTransportError(
      caught instanceof Error ? caught.message : "Judge call failed",
      { cause: caught },
    );
  }
}
