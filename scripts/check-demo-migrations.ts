/**
 * Demo migration layout (R-2): SQL under db/migrations-demo/ applied only by
 * `bun run db:migrate:demo`. Production drizzle journal under db/migrations/ is untouched.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dir = path.join(process.cwd(), "db", "migrations-demo");
const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
if (files.length === 0) throw new Error("demo migrations folder is empty");
for (const file of files) {
  await readFile(path.join(dir, file), "utf8");
}
console.log(`Validated ${files.length} demo migration(s)`);
