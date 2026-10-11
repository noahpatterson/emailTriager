export const MAX_CONTEST_MODEL_CALLS = 50;
export const MAX_CONTEST_RUN_TOKENS = 2_147_483_647;
export const MAX_CONTEST_RESPONSE_TOKENS = Math.floor(MAX_CONTEST_RUN_TOKENS / MAX_CONTEST_MODEL_CALLS);
export type ContestTokenUsage = Readonly<{ inputTokens: number; outputTokens: number }>;

/** Bound provider metadata and cumulative counters before writing PostgreSQL integers. */
export function addContestTokenUsage(current: ContestTokenUsage, response: ContestTokenUsage): ContestTokenUsage | null {
  const valid = (value: number, maximum: number) => Number.isInteger(value) && value >= 0 && value <= maximum;
  if (!valid(current.inputTokens, MAX_CONTEST_RUN_TOKENS) || !valid(current.outputTokens, MAX_CONTEST_RUN_TOKENS)
    || !valid(response.inputTokens, MAX_CONTEST_RESPONSE_TOKENS) || !valid(response.outputTokens, MAX_CONTEST_RESPONSE_TOKENS)) return null;
  const inputTokens = current.inputTokens + response.inputTokens;
  const outputTokens = current.outputTokens + response.outputTokens;
  return inputTokens <= MAX_CONTEST_RUN_TOKENS && outputTokens <= MAX_CONTEST_RUN_TOKENS ? { inputTokens, outputTokens } : null;
}
