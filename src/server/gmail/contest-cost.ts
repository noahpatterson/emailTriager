export type ContestCostRates = Readonly<{
  JEV_INPUT_USD_PER_MILLION_TOKENS?: string;
  JEV_OUTPUT_USD_PER_MILLION_TOKENS?: string;
}>;

function configuredRate(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

/** Estimate successful-response usage only. Failed-request charges remain unknown. */
export function estimateContestApiCost(
  inputTokens: number,
  outputTokens: number,
  rates: ContestCostRates = {
    JEV_INPUT_USD_PER_MILLION_TOKENS: process.env.JEV_INPUT_USD_PER_MILLION_TOKENS,
    JEV_OUTPUT_USD_PER_MILLION_TOKENS: process.env.JEV_OUTPUT_USD_PER_MILLION_TOKENS,
  },
): number | null {
  const inputRate = configuredRate(rates.JEV_INPUT_USD_PER_MILLION_TOKENS);
  const outputRate = configuredRate(rates.JEV_OUTPUT_USD_PER_MILLION_TOKENS);
  if (inputRate === null || outputRate === null || !Number.isSafeInteger(inputTokens)
    || !Number.isSafeInteger(outputTokens) || inputTokens < 0 || outputTokens < 0) return null;
  const estimate = inputTokens / 1_000_000 * inputRate + outputTokens / 1_000_000 * outputRate;
  return Number.isFinite(estimate) ? estimate : null;
}
