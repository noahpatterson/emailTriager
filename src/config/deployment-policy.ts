type Environment = Readonly<Record<string, string | undefined>>;

export type PersonalDeploymentPolicy = Readonly<{
  gmailWritesEnabled: boolean;
  externalAiEnabled: boolean;
}>;

function capability(env: Environment, name: string): boolean {
  const value = env[name];
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`Invalid personal configuration: ${name}`);
}

export function getPersonalDeploymentPolicy(env: Environment = process.env): PersonalDeploymentPolicy | null {
  if (env.APP_PROFILE?.trim() !== "personal") return null;
  return {
    gmailWritesEnabled: capability(env, "PERSONAL_GMAIL_WRITES_ENABLED"),
    externalAiEnabled: capability(env, "PERSONAL_EXTERNAL_AI_ENABLED"),
  };
}

export function assertDeploymentEnvironment(env: Environment = process.env): void {
  const hosted = Boolean(env.VERCEL || env.VERCEL_ENV);
  if ((hosted || env.APP_PROFILE?.trim() === "personal")
    && (env.INSECURE_LOCAL_DEV !== undefined || env.ALLOW_INSECURE_LOCAL_DEV !== undefined)) {
    throw new Error("Deployment forbids INSECURE_LOCAL_DEV and ALLOW_INSECURE_LOCAL_DEV");
  }
  if (getPersonalDeploymentPolicy(env) && env.VERCEL_ENV !== undefined && env.VERCEL_ENV !== "production") {
    throw new Error("APP_PROFILE=personal requires VERCEL_ENV=production");
  }
}

function requiredPersonal(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value || /(?:placeholder|replace[-_ ]?me|change[-_ ]?me|(?:^|[-_ ])(?:build|spike|demo|local-dev)(?:$|[-_ ]))/i.test(value)) {
    throw new Error(`Invalid personal configuration: ${name}`);
  }
  return value;
}

function secureUrl(env: Environment, name: string): URL {
  const value = requiredPersonal(env, name);
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || host === "::1" || host === "0.0.0.0") throw new Error();
    return url;
  } catch { throw new Error(`Invalid personal configuration: ${name}`); }
}

export function assertPersonalServerConfig(env: Environment = process.env): void {
  assertDeploymentEnvironment(env);
  if (!getPersonalDeploymentPolicy(env)) return;
  if (secureUrl(env, "GOOGLE_REDIRECT_URI").pathname !== "/api/oauth/google/callback") {
    throw new Error("Invalid personal configuration: GOOGLE_REDIRECT_URI");
  }
  secureUrl(env, "NEON_AUTH_BASE_URL");
  for (const name of ["OWNER_NEON_AUTH_USER_ID", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) requiredPersonal(env, name);
  if (requiredPersonal(env, "NEON_AUTH_COOKIE_SECRET").length < 32) throw new Error("Invalid personal configuration: NEON_AUTH_COOKIE_SECRET");
  const key = requiredPersonal(env, "TOKEN_ENCRYPTION_KEY_V1");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, "base64").length !== 32 || Buffer.from(key, "base64").toString("base64") !== key) {
    throw new Error("Invalid personal configuration: TOKEN_ENCRYPTION_KEY_V1");
  }
  try {
    const db = new URL(requiredPersonal(env, "DATABASE_URL"));
    if (!["postgres:", "postgresql:"].includes(db.protocol) || !db.hostname || !db.password
      || db.pathname.length <= 1 || db.hash || decodeURIComponent(db.username) !== "emailtriager_personal_app"
      || db.searchParams.getAll("sslmode").length !== 1
      || !["require", "verify-full"].includes(db.searchParams.get("sslmode") ?? "")) throw new Error();
  } catch { throw new Error("Invalid personal configuration: DATABASE_URL"); }
}

export function assertLiveGmailAllowed(env: Environment = process.env): void {
  assertDeploymentEnvironment(env);
  if (env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development") throw new Error("Live Gmail requires VERCEL_ENV=production");
}

export function assertGmailWritesAllowed(env: Environment = process.env): void {
  assertLiveGmailAllowed(env);
  if (getPersonalDeploymentPolicy(env)?.gmailWritesEnabled === false) throw new Error("PERSONAL_GMAIL_WRITES_ENABLED is disabled");
}

export function assertExternalAiAllowed(env: Environment = process.env): void {
  assertDeploymentEnvironment(env);
  if (env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development") throw new Error("External AI requires VERCEL_ENV=production");
  if (getPersonalDeploymentPolicy(env)?.externalAiEnabled === false) throw new Error("PERSONAL_EXTERNAL_AI_ENABLED is disabled");
}
