import { Pool } from "pg";
import { appTables, ownerDatabaseUrl, readPersonalEnvironment, roleSafetyQuery } from "./personal-operations";

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
let pool: Pool | undefined;
let phase = "configuration";
let failureCode: string | undefined;
let safetyChecks: Record<string, boolean> | undefined;
try {
  const args = process.argv.slice(2);
  if (args.includes("--remote")) throw new Error("Invalid arguments");
  const env = await readPersonalEnvironment(args);
  const password = env.PERSONAL_APP_DB_PASSWORD;
  if (!password || password.length < 32 || /placeholder|replace|change-me/i.test(password)) throw new Error("Invalid password");
  pool = new Pool({ connectionString: ownerDatabaseUrl(env), max: 1, connectionTimeoutMillis: 10000 });
  phase = "connect";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL standard_conforming_strings = on");
    const role = "emailtriager_personal_app";
    phase = "create_role";
    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
    if (exists.rowCount === 0) await client.query(`CREATE ROLE ${identifier(role)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    phase = "configure_role";
    await client.query(`ALTER ROLE ${identifier(role)} LOGIN PASSWORD ${literal(password)}`);
    phase = "remove_memberships";
    const memberships = await client.query<{ name: string }>("SELECT r.rolname AS name FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles member ON member.oid=m.member WHERE member.rolname=$1", [role]);
    for (const member of memberships.rows) await client.query(`REVOKE ${identifier(member.name)} FROM ${identifier(role)}`);
    phase = "restrict_schemas";
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await client.query(`REVOKE ALL ON SCHEMA public FROM ${identifier(role)}`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${identifier(role)}`);
    await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${identifier(role)}`);
    const schemas = await client.query<{ name: string }>("SELECT nspname AS name FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema')");
    for (const schema of schemas.rows) {
      await client.query(`REVOKE ALL ON SCHEMA ${identifier(schema.name)} FROM ${identifier(role)}`);
    }
    await client.query(`GRANT USAGE ON SCHEMA public TO ${identifier(role)}`);
    phase = "grant_application_tables";
    for (const table of appTables) {
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${identifier(table)} TO ${identifier(role)}`);
      const sequences = await client.query<{ name: string | null }>("SELECT pg_get_serial_sequence($1, a.attname) AS name FROM pg_attribute a WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped", [`public.${table}`]);
      for (const sequence of sequences.rows) if (sequence.name) {
        const parts = sequence.name.split(".").map((part) => identifier(part.replaceAll('"', '')));
        await client.query(`GRANT USAGE ON SEQUENCE ${parts.join(".")} TO ${identifier(role)}`);
      }
    }
    phase = "verify_role";
    const safety = await client.query<Record<string, boolean>>(roleSafetyQuery.replaceAll("current_user", literal(role)));
    safetyChecks = safety.rows[0];
    if (safety.rows.length !== 1 || !Object.values(safety.rows[0]).every((value) => value === true)) throw new Error("Unsafe role");
    await client.query("COMMIT");
  } catch (caught) {
    if (caught && typeof caught === "object" && "code" in caught && typeof caught.code === "string" && /^[A-Z0-9]{5}$/.test(caught.code)) failureCode = caught.code;
    await client.query("ROLLBACK");
    throw new Error("Provisioning failed");
  }
  finally { client.release(); }
  console.log(JSON.stringify({ roleProvisioned: true }));
} catch {
  console.error(JSON.stringify({ roleProvisioned: false, phase, failureCode, safetyChecks }));
  process.exitCode = 1;
} finally { await pool?.end(); }
