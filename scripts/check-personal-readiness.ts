import { Pool } from "pg";
import { assertPersonalServerConfig, getPersonalDeploymentPolicy } from "../src/config/deployment-policy";
import { productionSecrets, readPersonalEnvironment, roleSafetyQuery } from "./personal-operations";

type RemoteEnv = { id?: string; key: string; target?: string[]; type?: string; value?: string };
async function vercelRead(env: Record<string, string>, path: string): Promise<Record<string, unknown>> {
  const token = env.VERCEL_API_TOKEN;
  if (!token) throw new Error("Missing token");
  const url = new URL(path, "https://api.vercel.com");
  if (env.VERCEL_TEAM_ID) url.searchParams.set("teamId", env.VERCEL_TEAM_ID);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Remote read failed");
  return await response.json() as Record<string, unknown>;
}

const checks: Record<string, boolean> = { explicitEnvironment: false, configuration: false };
let pool: Pool | undefined;
try {
  const args = process.argv.slice(2);
  const env = await readPersonalEnvironment(args);
  checks.explicitEnvironment = true;
  assertPersonalServerConfig({ ...env, VERCEL: "1", VERCEL_ENV: "production" });
  const database = new URL(env.DATABASE_URL);
  if (!database.hostname.endsWith(".neon.tech") || !database.hostname.includes("-pooler")) throw new Error("Invalid runtime connection");
  const policy = getPersonalDeploymentPolicy(env);
  if (policy?.externalAiEnabled && !env.JEV_API_KEY?.trim()) throw new Error("Missing classifier credential");
  const requiredSecrets: readonly string[] = policy?.externalAiEnabled ? [...productionSecrets, "JEV_API_KEY"] : productionSecrets;
  checks.configuration = true;
  if (args.includes("--remote")) {
    Object.assign(checks, { databaseRole: false, hobbyAccount: false, projectScope: false, allDeploymentsProtected: false, previewsDisabled: false, forkProtection: false, productionSecretsOnly: false, profileMarkerAllEnvironments: false, requestedCapabilities: false });
    if (!env.VERCEL_PROJECT_ID || !env.VERCEL_ACCOUNT_ID) throw new Error("Missing project scope");
    const projectId = encodeURIComponent(env.VERCEL_PROJECT_ID);
    const project = await vercelRead(env, `/v9/projects/${projectId}`);
    checks.projectScope = project.id === env.VERCEL_PROJECT_ID && project.accountId === env.VERCEL_ACCOUNT_ID
      && (!env.VERCEL_TEAM_ID || env.VERCEL_TEAM_ID === env.VERCEL_ACCOUNT_ID);
    checks.allDeploymentsProtected = (project.ssoProtection as { deploymentType?: string } | undefined)?.deploymentType === "all";
    checks.previewsDisabled = project.previewDeploymentsDisabled === true;
    checks.forkProtection = project.gitForkProtection === true;
    const account = await vercelRead(env, env.VERCEL_TEAM_ID ? `/v2/teams/${encodeURIComponent(env.VERCEL_TEAM_ID)}` : "/v2/user");
    const details = env.VERCEL_TEAM_ID ? account : account.user as Record<string, unknown> | undefined;
    checks.hobbyAccount = details?.id === env.VERCEL_ACCOUNT_ID && (details.billing as { plan?: string } | undefined)?.plan === "hobby";
    // List metadata without decryption. Only the three nonsecret policy settings are read individually.
    const listing = await vercelRead(env, `/v9/projects/${projectId}/env`);
    const variables = listing.envs as RemoteEnv[] | undefined;
    const settingValue = async (key: "APP_PROFILE" | "PERSONAL_GMAIL_WRITES_ENABLED" | "PERSONAL_EXTERNAL_AI_ENABLED"): Promise<string | undefined> => {
      const matches = variables?.filter((variable) => variable.key === key);
      if (!matches || matches.length !== 1 || matches[0].type === "sensitive") return undefined;
      if (matches[0].type === "plain") return matches[0].value;
      if (matches[0].type !== "encrypted" || !matches[0].id) return undefined;
      const setting = await vercelRead(env, `/v10/projects/${projectId}/env/${encodeURIComponent(matches[0].id)}`);
      return setting.key === key && typeof setting.value === "string" ? setting.value : undefined;
    };
    const markers = variables?.filter((variable) => variable.key === "APP_PROFILE");
    checks.profileMarkerAllEnvironments = Array.isArray(markers) && markers.length === 1 && await settingValue("APP_PROFILE") === "personal"
      && markers[0].target?.length === 3 && ["production", "preview", "development"].every((target) => markers[0].target?.includes(target));
    const capabilities = ["PERSONAL_GMAIL_WRITES_ENABLED", "PERSONAL_EXTERNAL_AI_ENABLED"] as const;
    const capabilityChecks = await Promise.all(capabilities.map(async (key) => {
      const matches = variables?.filter((variable) => variable.key === key);
      return matches?.length === 1 && await settingValue(key) === env[key]
        && matches[0].target?.length === 1 && matches[0].target[0] === "production";
    }));
    checks.requestedCapabilities = capabilityChecks.every(Boolean);
    checks.productionSecretsOnly = Array.isArray(variables) && requiredSecrets.every((key) => {
      const matches = variables.filter((variable) => variable.key === key);
      return matches.length === 1 && matches[0].target?.length === 1 && matches[0].target[0] === "production"
        && ["encrypted", "sensitive"].includes(matches[0].type ?? "");
    }) && variables.every((variable) => !["MODEL_API_KEY", "JEV_API_KEY"].includes(variable.key) || ["encrypted", "sensitive"].includes(variable.type ?? ""))
      && variables.every((variable) => (variable.key === "APP_PROFILE" && checks.profileMarkerAllEnvironments) || !["encrypted", "sensitive"].includes(variable.type ?? "")
      || (variable.target?.length === 1 && variable.target[0] === "production")) && !variables.some((variable) => ["PERSONAL_DATABASE_URL_UNPOOLED", "PERSONAL_APP_DB_PASSWORD", "DATABASE_URL_UNPOOLED", "VERCEL_API_TOKEN", "NEON_API_KEY", "TF_CLOUD_ORGANIZATION", "TF_VAR_team_id", "TF_VAR_project_name"].includes(variable.key));
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = '10s'");
      const role = await client.query<Record<string, boolean>>(roleSafetyQuery);
      checks.databaseRole = role.rows.length === 1 && Object.values(role.rows[0]).every((value) => value === true);
      await client.query("ROLLBACK");
    } finally { client.release(); }
  }
} catch { process.exitCode = 1; }
finally { await pool?.end(); }
const ready = Object.values(checks).every(Boolean);
if (!ready) process.exitCode = 1;
console.log(JSON.stringify({ ...checks, ready }));
