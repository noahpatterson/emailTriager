import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appTables, ownerDatabaseUrl, readPersonalEnvironment } from "../../scripts/personal-operations";
import * as schema from "../../db/schema";
import { getTableName, is, Table } from "drizzle-orm";

describe("personal operations", () => {
  test("requires an explicit file and never fills missing values from the process", async () => {
    const dir = await mkdtemp(join(tmpdir(), "personal-env-"));
    try {
      const file = join(dir, ".env");
      await writeFile(file, "APP_PROFILE=personal\n");
      const env = await readPersonalEnvironment(["--env-file", file]);
      expect(env).toEqual({ APP_PROFILE: "personal" });
      await expect(readPersonalEnvironment([])).rejects.toThrow();
      await writeFile(file, "APP_PROFILE=demo\n");
      await expect(readPersonalEnvironment(["--env-file", file])).rejects.toThrow();
    } finally { await rm(dir, { recursive: true }); }
  });

  test("owner connections cannot fall back to runtime or demo credentials", () => {
    const owner = "postgresql://personal_owner:random-password@ep-personal.us-east-2.aws.neon.tech/personal?sslmode=require";
    const runtime = owner.replace("personal_owner", "emailtriager_personal_app").replace("ep-personal.", "ep-personal-pooler.");
    const connection = (value: string) => ({ PERSONAL_DATABASE_URL_UNPOOLED: value, DATABASE_URL: runtime });
    expect(ownerDatabaseUrl(connection(owner))).toBe(owner);
    expect(() => ownerDatabaseUrl({ DATABASE_URL: owner })).toThrow();
    expect(() => ownerDatabaseUrl(connection(owner.replace("ep-personal.", "ep-personal-pooler.")))).toThrow();
    expect(() => ownerDatabaseUrl(connection(owner.replace("personal_owner", "emailtriager_personal_app")))).toThrow();
    expect(() => ownerDatabaseUrl(connection(owner.replace("?sslmode=require", "")))).toThrow();
    expect(() => ownerDatabaseUrl(connection(owner.replace("/personal?", "/other?")))).toThrow();
    expect(() => ownerDatabaseUrl(connection(`${owner}&sslmode=require`))).toThrow();
    expect(() => ownerDatabaseUrl(connection(`${owner}#fragment`))).toThrow();
  });

  test("the reviewed grants cover the current application schema and no other tables", () => {
    const names = Object.values(schema).filter((value) => is(value, Table)).map((table) => getTableName(table as Table));
    const reviewed: string[] = [...appTables];
    expect(reviewed.sort()).toEqual(names.sort());
    expect(appTables).not.toContain("__drizzle_migrations");
  });
});
