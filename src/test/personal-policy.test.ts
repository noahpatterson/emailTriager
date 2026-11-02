import { describe, expect, test } from "bun:test";
import { assertDeploymentEnvironment, assertPersonalServerConfig, getPersonalDeploymentPolicy } from "../config/deployment-policy";

const personal = {
  APP_PROFILE: "personal", VERCEL_ENV: "production",
  GOOGLE_REDIRECT_URI: "https://triage.example.com/api/oauth/google/callback",
  NEON_AUTH_BASE_URL: "https://auth.example.com",
  OWNER_NEON_AUTH_USER_ID: "owner-123",
  GOOGLE_CLIENT_ID: "client-123", GOOGLE_CLIENT_SECRET: "secret-123",
  DATABASE_URL: "postgresql://emailtriager_personal_app:secret@db.example.com/app?sslmode=require",
  TOKEN_ENCRYPTION_KEY_V1: Buffer.alloc(32, 7).toString("base64"),
  NEON_AUTH_COOKIE_SECRET: "a-real-cookie-secret-with-at-least-32-characters",
};

describe("personal deployment policy", () => {
  test("accepts a production configuration and defaults capabilities off", () => {
    assertPersonalServerConfig(personal);
    expect(getPersonalDeploymentPolicy({ ...personal, APP_PROFILE: "personal " })).toEqual({ gmailWritesEnabled: false, externalAiEnabled: false });
    expect(getPersonalDeploymentPolicy({ APP_PROFILE: "demo" })).toBeNull();
    expect(getPersonalDeploymentPolicy({ ...personal, PERSONAL_GMAIL_WRITES_ENABLED: "true", PERSONAL_EXTERNAL_AI_ENABLED: "true" })).toEqual({ gmailWritesEnabled: true, externalAiEnabled: true });
  });
  test("denies personal previews and hosted local bypasses", () => {
    expect(() => assertDeploymentEnvironment({ ...personal, VERCEL_ENV: "preview" })).toThrow("VERCEL_ENV");
    expect(() => assertDeploymentEnvironment({ APP_PROFILE: "local-compose", VERCEL: "1", INSECURE_LOCAL_DEV: "true" })).toThrow("INSECURE_LOCAL_DEV");
    expect(() => assertDeploymentEnvironment({ APP_PROFILE: "personal ", VERCEL_ENV: "preview" })).toThrow("VERCEL_ENV");
    expect(() => assertDeploymentEnvironment({ APP_PROFILE: "local-compose", VERCEL_ENV: "production", INSECURE_LOCAL_DEV: "false" })).toThrow("INSECURE_LOCAL_DEV");
    expect(() => assertDeploymentEnvironment({ APP_PROFILE: "personal", ALLOW_INSECURE_LOCAL_DEV: "" })).toThrow("ALLOW_INSECURE_LOCAL_DEV");
    expect(() => getPersonalDeploymentPolicy({ APP_PROFILE: "personal", PERSONAL_EXTERNAL_AI_ENABLED: "yes" })).toThrow("PERSONAL_EXTERNAL_AI_ENABLED");
  });
  test("rejects unsafe personal secrets without disclosing values", () => {
    for (const [name, value] of Object.entries({
      GOOGLE_REDIRECT_URI: "https://localhost/api/oauth/google/callback",
      NEON_AUTH_BASE_URL: "http://auth.example.com",
      OWNER_NEON_AUTH_USER_ID: "spike-owner",
      GOOGLE_CLIENT_SECRET: "build-placeholder-secret",
      DATABASE_URL: "postgresql://admin:secret@db.example.com/app?sslmode=require",
      TOKEN_ENCRYPTION_KEY_V1: Buffer.alloc(31, 7).toString("base64"),
      NEON_AUTH_COOKIE_SECRET: "too-short",
    })) {
      expect(() => assertPersonalServerConfig({ ...personal, [name]: value })).toThrow(`Invalid personal configuration: ${name}`);
    }
    for (const value of [
      "postgresql://emailtriager_personal_app@db.example.com/app?sslmode=require",
      "postgresql://emailtriager_personal_app:secret@db.example.com/?sslmode=require",
      "postgresql://emailtriager_personal_app:secret@db.example.com/app?sslmode=require#fragment",
    ]) {
      expect(() => assertPersonalServerConfig({ ...personal, DATABASE_URL: value })).toThrow("DATABASE_URL");
    }
  });
});
