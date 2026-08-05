import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { Category } from "@/src/server/gmail/corpus";

/** Zod stays at the model boundary only (ADR-0007). */
export const MAX_VERDICT_RATIONALE_CHARS = 500;

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
    });
    const object = result.output;
    if (!object) {
      return {
        agreesWithFiling: null,
        recommendedCategory: null,
        rationale: null,
        malformed: true,
        ...tags,
      };
    }
    return {
      agreesWithFiling: object.agrees_with_filing,
      recommendedCategory: object.recommended_category,
      rationale: object.rationale,
      malformed: false,
      ...tags,
    };
  } catch {
    return {
      agreesWithFiling: null,
      recommendedCategory: null,
      rationale: null,
      malformed: true,
      ...tags,
    };
  }
}
