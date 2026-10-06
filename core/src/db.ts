import postgres from "postgres";
import { env } from "./env.ts";
import type { Message } from "./grabbers/message.ts";
import type { GrabberConfig } from "./grabbers/index.ts";

export const sql = postgres(env.dbConnection);

/** users.id is a bigint; postgres.js returns it as a string, publicUser() coerces it */
export type UserRow = {
	id: number | string,
	name: string | null,
	access_token: string | null,
	tg_token: string | null,
	additional: string | null,
	grabbers: GrabberConfig[] | null,
	role: "admin" | "user",
	can_invite: boolean,
	created_at: Date
};

/** pool.id is a bigint, which postgres.js returns as a string */
export type PoolRow = {
	id: string,
	user: number,
	message: Message,
	approved: boolean | null,
	failed: boolean
};

export type ApiTokenRow = {
	id: number,
	name: string | null,
	created_at: Date,
	last_used_at: Date | null
};
