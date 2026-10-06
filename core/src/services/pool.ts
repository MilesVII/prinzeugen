import { sql, type PoolRow } from "../db.ts";
import { registry as grabbersMeta, type GrabberConfig } from "../grabbers/index.ts";
import type { Message } from "../grabbers/message.ts";

export type PoolPageRow = PoolRow & { total: number };

export function getApproved(user: number, limit: number, offset: number) {
	return sql<PoolPageRow[]>`
		select *, (count(*) over())::int as total
			from "pool"
			where "user" = ${user} and "approved" = true
			order by "failed" = false, id asc
			limit ${limit}
			offset ${offset}
	`;
}

export function getModerables(user: number, limit = 200) {
	return sql<PoolRow[]>`
		select * from pool
			where "user" = ${user} and "approved" is null
			order by id asc
			limit ${limit}
	`;
}

export async function getStats(user: number) {
	const [row] = await sql`
		select
			count(*) filter (where "approved" = true) as approved,
			count(*) filter (where "failed" = true) as failed,
			count(*) filter (where "approved" is null) as pending
		from pool
		where "user" = ${user}
	`;
	return {
		approved: Number(row?.approved ?? 0),
		failed: Number(row?.failed ?? 0),
		pending: Number(row?.pending ?? 0)
	};
}

export async function getGrabbers(user: number): Promise<GrabberConfig[]> {
	const [row] = await sql`select "grabbers" from "users" where "id" = ${user}`;
	return row?.grabbers ?? [];
}

export function setGrabbers(user: number, grabbers: GrabberConfig[]) {
	return sql`
		update users
			set ${sql({ grabbers: grabbers as any })}
			where "id" = ${user}
	`;
}

export type Decision = { id: number, approved: boolean };
export async function moderate(user: number, decisions: Decision[]) {
	if (decisions.length === 0) return;
	// postgres.js types value lists as string|number, booleans are fine at runtime
	const rows = decisions.map(({ id, approved }) => [id, approved]) as unknown as (string | number)[][];
	await sql.begin(async sql => {
		await sql`
			update "pool"
				set approved = (update_data.approved)::boolean
				from (values ${sql(rows)}) as update_data(id, approved)
				where pool.id = (update_data.id)::bigint and pool."user" = ${user}
		`;
		await sql`delete from "pool" where "user" = ${user} and "approved" = false`;
	});
}

// published_logs.post_id references pool.id without cascade, so logs go first

export function wipePool(user: number) {
	return sql.begin(async sql => {
		await sql`delete from published_logs where post_id in (select id from pool where "user" = ${user})`;
		await sql`delete from "pool" where "user" = ${user}`;
	});
}

export function unschedulePost(user: number, id: string) {
	return sql.begin(async sql => {
		await sql`delete from published_logs where post_id = ${id} and post_id in (select id from pool where "user" = ${user})`;
		await sql`delete from "pool" where "user" = ${user} and "id" = ${id}`;
	});
}

export function unfailPost(user: number, id: string) {
	return sql`update "pool" set failed = false where "user" = ${user} and "id" = ${id}`;
}

/**
 * Runs the user's grabbers (all, or the one at `index`) and stores the results.
 * Returns the number of new pool entries, or null when the index is out of range.
 */
export async function grab(user: number, index?: number, batchLimit?: number): Promise<number | null> {
	const grabbers = await getGrabbers(user);
	if (grabbers.length === 0) return 0;

	let selection = grabbers;
	if (index !== undefined) {
		const picked = grabbers[index];
		if (!picked) return null;
		selection = [picked];
	}

	const moderated: Promise<Message[]>[] = [];
	const approved: Promise<Message[]>[] = [];
	for (const grabber of selection) {
		const prom = grabbersMeta[grabber.type].grab(grabber, { batchLimit });
		if (grabber.config.moderated)
			moderated.push(prom);
		else
			approved.push(prom);
	}

	const entry = (message: Message, isApproved: true | null) => ({
		message: message as any,
		user,
		failed: false,
		approved: isApproved
	});
	const newEntries = [
		...(await Promise.all(moderated)).flat().map(m => entry(m, null)),
		...(await Promise.all(approved)).flat().map(m => entry(m, true))
	];

	if (newEntries.length > 0) {
		// grabbers carry mutable state (lastSeen), persist it together with the new posts
		await sql.begin(async sql => {
			await sql`insert into pool ${sql(newEntries)}`;
			await sql`update users set ${sql({ grabbers: grabbers as any })} where "id" = ${user}`;
		});
	}
	return newEntries.length;
}
