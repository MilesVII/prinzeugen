import { sql, type UserRow } from "../db.ts";
import { getModerables, getStats } from "./pool.ts";

export async function findUserById(id: number): Promise<UserRow | null> {
	const rows = await sql<UserRow[]>`select * from users where id = ${id}`;
	return rows[0] ?? null;
}

/** Accepts a numeric id or a unique name */
export async function findUserByIdentifier(identifier: string | number): Promise<UserRow | null> {
	const raw = String(identifier).trim();
	if (/^\d+$/.test(raw)) return findUserById(parseInt(raw, 10));

	const rows = await sql<UserRow[]>`select * from users where name = ${raw} limit 2`;
	return rows.length === 1 ? rows[0]! : null;
}

export function publicUser(user: UserRow) {
	const { access_token, ...rest } = user;
	// users.id is a bigint, postgres.js hands it over as a string
	return { ...rest, id: Number(user.id) };
}

/** Everything the dashboard needs right after sign-in */
export async function userBundle(user: UserRow) {
	const id = Number(user.id);
	const [moderables, stats] = await Promise.all([
		getModerables(id),
		getStats(id)
	]);
	return {
		user: publicUser(user),
		moderables,
		stats
	};
}
