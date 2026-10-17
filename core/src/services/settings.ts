import { sql } from "../db.ts";

/** Server-wide settings in app_settings; values are JSON */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
	const [row] = await sql`select value from app_settings where key = ${key}`;
	return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
	await sql`
		insert into app_settings (key, value, updated_at)
			values (${key}, ${sql.json(value as any)}, now())
			on conflict (key) do update set value = excluded.value, updated_at = now()
	`;
}
