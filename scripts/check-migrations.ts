import { readFile } from "node:fs/promises";

const journalPath = "db/migrations/meta/_journal.json";
const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
  entries: Array<{ tag: string }>;
};

if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
  throw new Error("Drizzle migration journal is empty");
}

const tags = journal.entries.map((entry) => entry.tag);
if (new Set(tags).size !== tags.length) {
  throw new Error("Drizzle migration journal has duplicated tags");
}

for (const tag of tags) {
  await readFile(`db/migrations/${tag}.sql`, "utf8");
}

console.log(`Validated ${tags.length} Drizzle migration(s)`);
