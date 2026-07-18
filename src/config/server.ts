import "server-only";

type ServerConfig = Readonly<{
  databaseUrl: string;
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

export function getServerConfig(): ServerConfig {
  return {
    databaseUrl: required("DATABASE_URL"),
    neonAuthBaseUrl: required("NEON_AUTH_BASE_URL"),
    neonAuthCookieSecret: required("NEON_AUTH_COOKIE_SECRET"),
    ownerNeonAuthUserId: required("OWNER_NEON_AUTH_USER_ID"),
    googleClientId: required("GOOGLE_CLIENT_ID"),
    googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri: required("GOOGLE_REDIRECT_URI"),
    tokenEncryptionKeyV1: required("TOKEN_ENCRYPTION_KEY_V1"),
  };
}
