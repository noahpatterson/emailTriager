import { readFile } from "node:fs/promises";
import { parse } from "dotenv";

export const appTables = [
  "owner_binding", "gmail_connection", "triage_config", "sync_run", "sync_lease",
  "message_processing", "gmail_message_state", "oauth_state", "message_snapshot",
  "golden_set_message", "eval_run", "prompt_version", "audit_run", "verdict",
  "pending_demotion", "contest_settings", "contest_scan_run", "contest_message",
] as const;
export const productionSecrets = [
  "DATABASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI",
  "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET", "OWNER_NEON_AUTH_USER_ID", "TOKEN_ENCRYPTION_KEY_V1",
] as const;

export async function readPersonalEnvironment(args: string[]): Promise<Record<string, string>> {
  const index = args.indexOf("--env-file");
  if (index < 0 || !args[index + 1] || args.filter((arg) => arg === "--env-file").length !== 1
    || args.some((arg, position) => position !== index && position !== index + 1 && arg !== "--remote")) throw new Error("Invalid arguments");
  const env = parse(await readFile(args[index + 1]));
  if (env.APP_PROFILE !== "personal") throw new Error("Invalid profile");
  return env;
}

export function ownerDatabaseUrl(env: Record<string, string>): string {
  const raw = env.PERSONAL_DATABASE_URL_UNPOOLED;
  if (!raw) throw new Error("Missing owner connection");
  const url = new URL(raw);
  const runtime = new URL(env.DATABASE_URL ?? "");
  const complete = (value: URL) => ["postgres:", "postgresql:"].includes(value.protocol)
    && Boolean(value.username && value.password && value.pathname.length > 1)
    && !value.hash && value.searchParams.getAll("sslmode").length === 1
    && ["require", "verify-full"].includes(value.searchParams.get("sslmode") ?? "");
  if (!complete(url) || !complete(runtime)
    || !url.hostname.endsWith(".neon.tech") || url.hostname.includes("-pooler")
    || decodeURIComponent(url.username) === "emailtriager_personal_app"
    || decodeURIComponent(runtime.username) !== "emailtriager_personal_app"
    || !runtime.hostname.includes("-pooler")
    || runtime.hostname.replace("-pooler", "") !== url.hostname
    || runtime.pathname !== url.pathname || runtime.port !== url.port) throw new Error("Invalid owner connection");
  return raw;
}

export const roleSafetyQuery = `SELECT
  current_user = 'emailtriager_personal_app' AS expected_role,
  NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication) AS unprivileged,
  NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid <> me.oid AND pg_has_role(current_user, r.oid, 'MEMBER')) AS no_memberships,
  NOT has_schema_privilege(current_user, 'public', 'CREATE') AS no_public_create,
  NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND (n.nspowner = me.oid OR (n.nspname <> 'public' AND has_schema_privilege(current_user, n.oid, 'USAGE, CREATE')))) AS no_private_schema_access,
  NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner = me.oid) AS no_relation_ownership,
  NOT EXISTS (SELECT 1 FROM pg_database d WHERE d.datdba = me.oid) AS no_database_ownership,
  NOT has_database_privilege(current_user, current_database(), 'CREATE') AS no_database_create,
  NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proowner = me.oid) AS no_function_ownership
FROM pg_roles me WHERE me.rolname = current_user`;
