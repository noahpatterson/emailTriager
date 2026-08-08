import "server-only";
import {
  assertInsecureLocalDevAllowed,
  assertInsecureLocalDevConfiguredOrigin,
  isInsecureLocalDevRequested,
  LOCAL_DEV_OWNER_ID_DEFAULT,
} from "@/src/server/auth/local-dev-flags";
import { isDemoProfile } from "@/src/server/demo/ai-gate";

export type DatabaseDriver = "neon-http" | "pg";

type ServerConfig = Readonly<{
  databaseUrl: string;
  databaseDriver: DatabaseDriver;
  insecureLocalDev: boolean;
  demoProfile: boolean;
  neonAuthBaseUrl: string;
  neonAuthCookieSecret: string;
  ownerNeonAuthUserId: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  tokenEncryptionKeyV1: string;
  retentionDays: number;
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

function parseDatabaseDriver(): DatabaseDriver {
  const raw = process.env.DATABASE_DRIVER?.trim().toLowerCase();
  if (!raw || raw === "neon-http") return "neon-http";
  if (raw === "pg") return "pg";
  throw new Error(`Invalid DATABASE_DRIVER: ${raw}. Expected neon-http or pg.`);
}

function retentionDays(): number {
  const raw = optional("RETENTION_DAYS");
  if (!raw) return 30;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new Error("RETENTION_DAYS must be an integer from 1 to 3650");
  }
  return value;
}

export function getServerConfig(): ServerConfig {
  const insecureLocalDev = isInsecureLocalDevRequested();
  const demoProfile = isDemoProfile();
  const databaseDriver = parseDatabaseDriver();
  assertInsecureLocalDevAllowed(databaseDriver);
  if (demoProfile && databaseDriver !== "pg") {
    throw new Error("APP_PROFILE=demo requires DATABASE_DRIVER=pg");
  }
  if (demoProfile && insecureLocalDev) {
    throw new Error("APP_PROFILE=demo cannot combine with INSECURE_LOCAL_DEV");
  }
  const googleRedirectUri = required("GOOGLE_REDIRECT_URI");
  if (insecureLocalDev) assertInsecureLocalDevConfiguredOrigin(googleRedirectUri);

  const skipNeonAuth = insecureLocalDev || demoProfile;

  return {
    databaseUrl: required("DATABASE_URL"),
    databaseDriver,
    insecureLocalDev,
    demoProfile,
    neonAuthBaseUrl: skipNeonAuth
      ? (optional("NEON_AUTH_BASE_URL") ?? "")
      : required("NEON_AUTH_BASE_URL"),
    neonAuthCookieSecret: skipNeonAuth
      ? (optional("NEON_AUTH_COOKIE_SECRET") ?? "")
      : required("NEON_AUTH_COOKIE_SECRET"),
    ownerNeonAuthUserId: skipNeonAuth
      ? (optional("OWNER_NEON_AUTH_USER_ID") ?? LOCAL_DEV_OWNER_ID_DEFAULT)
      : required("OWNER_NEON_AUTH_USER_ID"),
    googleClientId: required("GOOGLE_CLIENT_ID"),
    googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri,
    tokenEncryptionKeyV1: required("TOKEN_ENCRYPTION_KEY_V1"),
    retentionDays: retentionDays(),
  };
}
