import postgres from "postgres";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "../../db/migrations");

const connection = Bun.env.DB_CONNECTION;
if (!connection) {
	console.error("DB_CONNECTION is not set (put it in .env at the repository root)");
	process.exit(1);
}

const sql = postgres(connection);

await sql`
	create table if not exists schema_migrations (
		name text primary key,
		applied_at timestamptz not null default now()
	)
`;

const applied = new Set(
	(await sql`select name from schema_migrations`).map(row => row.name as string)
);

const files = (await readdir(MIGRATIONS_DIR))
	.filter(file => file.endsWith(".sql"))
	.sort();

let count = 0;
for (const file of files) {
	if (applied.has(file)) continue;

	const body = await Bun.file(join(MIGRATIONS_DIR, file)).text();
	await sql.begin(async tx => {
		await tx.unsafe(body);
		await tx`insert into schema_migrations (name) values (${file})`;
	});
	console.log(`applied ${file}`);
	++count;
}

console.log(count === 0 ? "database is up to date" : `${count} migration(s) applied`);
await sql.end();
