import { execFile } from "node:child_process";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : {};
}

// Capture command output for parsing only. Never print device identities or errors.
async function command(args: string[]): Promise<unknown> {
  return new Promise((resolve) => {
    execFile("tailscale", args, { timeout: 5_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

const present = Boolean(Bun.which("tailscale"));
const status = present ? record(await command(["status", "--json"])) : {};
const serve = present ? record(await command(["serve", "status", "--json"])) : {};
const tcp = record(serve.TCP);
const web = record(serve.Web);
const httpsConfigured = record(tcp["443"]).HTTPS === true;
const proxyConfigured = Object.entries(web).some(([authority, config]) =>
  authority.endsWith(":443")
  && record(record(record(config).Handlers)["/"]).Proxy === "http://127.0.0.1:3000",
);
const funnelDisabled = Object.values(record(serve.AllowFunnel)).every((enabled) => enabled === false);
let localHealth = false;
try {
  const response = await fetch("http://127.0.0.1:3000/api/health", {
    signal: AbortSignal.timeout(5_000), redirect: "error",
  });
  localHealth = response.ok && record(await response.json()).ok === true;
} catch { /* An unavailable local service is a failed prerequisite. */ }

const has = (name: string): boolean => Boolean(process.env[name]?.trim());
const insecureFlag = process.env.INSECURE_LOCAL_DEV?.trim().toLowerCase() === "true";
const bypassSentinel = process.env.ALLOW_INSECURE_LOCAL_DEV === "I_UNDERSTAND";
const profile = process.env.APP_PROFILE?.trim();
const localComposeProfile = profile === "local-compose";
const fixtureProfile = profile === "demo" || profile === "ci";
let tailnetCallback = false;
try {
  const url = new URL(process.env.GOOGLE_REDIRECT_URI ?? "");
  tailnetCallback = url.protocol === "https:" && url.hostname.endsWith(".ts.net")
    && url.pathname === "/api/oauth/google/callback" && !url.search && !url.hash
    && !url.username && !url.password && (!url.port || url.port === "443")
    && record(record(record(web[`${url.hostname}:443`]).Handlers)["/"]).Proxy
      === "http://127.0.0.1:3000";
} catch { /* Configuration is absent or invalid. */ }

const checks = {
  cliPresent: present,
  tailscaleLoggedIn: status.BackendState === "Running" && record(status.Self).Online === true,
  serveHttpsLoopbackProxy: httpsConfigured && proxyConfigured,
  funnelDisabled,
  localHealth,
  insecureFlag,
  bypassSentinel,
  localComposeProfile,
  fixtureProfile,
  neonAuthConfigured: has("NEON_AUTH_BASE_URL") && has("NEON_AUTH_COOKIE_SECRET")
    && has("OWNER_NEON_AUTH_USER_ID"),
  tailnetCallback,
};
console.log(JSON.stringify(checks, null, 2));
process.exitCode = checks.cliPresent && checks.tailscaleLoggedIn
  && checks.serveHttpsLoopbackProxy && checks.funnelDisabled && checks.localHealth
  && !insecureFlag && !bypassSentinel && !localComposeProfile && !fixtureProfile
  && checks.neonAuthConfigured && tailnetCallback ? 0 : 1;
