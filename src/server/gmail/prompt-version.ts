import { createHash } from "node:crypto";
import { JUDGE_SYSTEM_PREAMBLE } from "@/src/server/gmail/judge-prompt";

/** Append-only prompt contract — hashed body must match JUDGE_SYSTEM_PREAMBLE. */
export const JUDGE_PROMPT_VERSION_BODY = JUDGE_SYSTEM_PREAMBLE;

export function promptVersionIdFor(body: string = JUDGE_PROMPT_VERSION_BODY): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 32);
}
