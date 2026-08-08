import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { decryptSecret } from "@/src/server/security/crypto";

export type ModelRuntimeConfig = Readonly<{
  provider: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
}>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/**
 * Plaintext API key, or encryptSecret ciphertext (`v1.…`) decrypted with TOKEN_ENCRYPTION_KEY_V1.
 * Ciphertext keeps secrets out of plaintext env dumps (Slice 4 encrypted model_api_key).
 */
export function resolveModelApiKey(
  raw: string,
  encryptionKey: string | undefined = process.env.TOKEN_ENCRYPTION_KEY_V1?.trim(),
): string {
  if (!raw.startsWith("v1.")) return raw;
  if (!encryptionKey) {
    throw new Error("Missing required server configuration: TOKEN_ENCRYPTION_KEY_V1");
  }
  return decryptSecret(raw, encryptionKey);
}

/** Model connection for audit/judge. Env-backed; Zod stays out of this path. */
export function getModelConfig(): ModelRuntimeConfig {
  return {
    provider: optional("MODEL_PROVIDER") ?? "openai-compatible",
    modelName: required("MODEL_NAME"),
    baseUrl: required("MODEL_BASE_URL"),
    apiKey: resolveModelApiKey(required("MODEL_API_KEY")),
  };
}

export function createJudgeModel(config: ModelRuntimeConfig = getModelConfig()): LanguageModel {
  const provider = createOpenAICompatible({
    name: config.provider,
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    // Without this, the SDK falls back to response_format=json_object, and OpenAI
    // 400s unless the prompt contains the word "json" — surfaced as judge_transport.
    supportsStructuredOutputs: true,
  });
  return provider.chatModel(config.modelName);
}
