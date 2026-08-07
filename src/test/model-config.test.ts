import { describe, expect, mock, test } from "bun:test";
import { encryptSecret } from "../server/security/crypto";

mock.module("server-only", () => ({}));

const { resolveModelApiKey } = await import("../server/gmail/model-config");

describe("resolveModelApiKey", () => {
  test("passes through plaintext keys", () => {
    expect(resolveModelApiKey("sk-plaintext")).toBe("sk-plaintext");
  });

  test("decrypts encryptSecret ciphertext with TOKEN_ENCRYPTION_KEY_V1", () => {
    const key = "unit-test-token-encryption-key!!";
    const ciphertext = encryptSecret("sk-secret", key);
    expect(resolveModelApiKey(ciphertext, key)).toBe("sk-secret");
  });

  test("requires TOKEN_ENCRYPTION_KEY_V1 for ciphertext", () => {
    const ciphertext = encryptSecret("sk-secret", "unit-test-token-encryption-key!!");
    expect(() => resolveModelApiKey(ciphertext, "")).toThrow(
      "TOKEN_ENCRYPTION_KEY_V1",
    );
  });
});
