import "server-only";
import {
  assertInsecureLocalDevAllowed,
  isInsecureLocalDevRequested,
  LOCAL_DEV_OWNER_ID_DEFAULT,
} from "@/src/server/auth/local-dev-flags";

export type DatabaseDriver = "neon-http" | "pg";

type ServerConfig = Readonly<{
  databaseUrl: string;
  databaseDriver: DatabaseDriver;
  insecureLocalDev: boolean;
  neonAuthBaseUrl: string;
  neonAuthCookieSecret: string;
  ownerNeonAuthUserId: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  tokenEncryptionKeyV1: string;
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

export function getServerConfig(): ServerConfig {
  const insecureLocalDev = isInsecureLocalDevRequested();
  const databaseDriver = parseDatabaseDriver();
  assertInsecureLocalDevAllowed(databaseDriver);

  return {
    databaseUrl: required("DATABASE_URL"),
    databaseDriver,
    insecureLocalDev,
    neonAuthBaseUrl: insecureLocalDev
      ? (optional("NEON_AUTH_BASE_URL") ?? "")
      : required("NEON_AUTH_BASE_URL"),
    neonAuthCookieSecret: insecureLocalDev
      ? (optional("NEON_AUTH_COOKIE_SECRET") ?? "")
      : required("NEON_AUTH_COOKIE_SECRET"),
    ownerNeonAuthUserId: insecureLocalDev
      ? (optional("OWNER_NEON_AUTH_USER_ID") ?? LOCAL_DEV_OWNER_ID_DEFAULT)
      : required("OWNER_NEON_AUTH_USER_ID"),
    googleClientId: required("GOOGLE_CLIENT_ID"),
    googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri: required("GOOGLE_REDIRECT_URI"),
    tokenEncryptionKeyV1: required("TOKEN_ENCRYPTION_KEY_V1"),
  };
}
