import { pbkdf2Sync, timingSafeEqual, createHash, randomBytes } from "node:crypto";
import type { Sql } from "postgres";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

// Hashes produced by the previous dashboard version: pbkdf2 with a fixed salt.
// They are accepted once and transparently upgraded to argon2id on login.
const LEGACY_SALT = "m1ku39";
export function legacyHashPassword(raw: string) {
	return pbkdf2Sync(raw, LEGACY_SALT, 7000, 64, "sha512").toString("hex");
}

export function hashPassword(raw: string) {
	return Bun.password.hash(raw, { algorithm: "argon2id" });
}

export type PasswordCheck = "ok" | "legacy" | "fail";
export async function verifyPassword(raw: string, stored: string | null | undefined): Promise<PasswordCheck> {
	if (!stored) return "fail";

	if (stored.startsWith("$argon2") || stored.startsWith("$2")) {
		return (await Bun.password.verify(raw, stored)) ? "ok" : "fail";
	}

	const candidate = Buffer.from(legacyHashPassword(raw), "hex");
	const known = Buffer.from(stored, "hex");
	if (candidate.length !== known.length || known.length === 0) return "fail";
	return timingSafeEqual(candidate, known) ? "legacy" : "fail";
}

export function hashToken(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

export function newToken() {
	const token = randomBytes(32).toString("base64url");
	return { token, hash: hashToken(token) };
}

export function extractBearer(header: string | null | undefined): string | null {
	if (!header) return null;
	const [scheme, value] = header.split(" ");
	if (scheme?.toLowerCase() === "bearer" && value) return value.trim();
	return null;
}

export type AuthUser = {
	id: number,
	name: string | null,
	role: "admin" | "user",
	can_invite: boolean
};
export type AuthSession = {
	id: number,
	kind: "session" | "api",
	name: string | null,
	expires_at: Date | null
};
export type Auth = { user: AuthUser, session: AuthSession };

export async function resolveAuth(sql: Sql, token: string | null): Promise<Auth | null> {
	if (!token) return null;

	const rows = await sql`
		select
			s.id as session_id, s.kind, s.name as session_name, s.expires_at, s.last_used_at,
			u.id, u.name, u.role, u.can_invite
		from sessions s
		inner join users u on u.id = s.user_id
		where s.token_hash = ${hashToken(token)}
		limit 1
	`;
	const row = rows[0];
	if (!row) return null;

	if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
		await sql`delete from sessions where id = ${row.session_id}`;
		return null;
	}

	// Sliding expiry, refreshed at most once an hour to avoid a write per request
	const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
	if (Date.now() - lastUsed > 60 * 60 * 1000) {
		const expiresAt = row.kind === "session" ? new Date(Date.now() + SESSION_TTL_MS) : null;
		await sql`
			update sessions
				set last_used_at = now(), expires_at = ${expiresAt}
				where id = ${row.session_id}
		`;
	}

	return {
		user: {
			id: Number(row.id), // users.id is a bigint, postgres.js hands it over as a string
			name: row.name,
			role: row.role === "admin" ? "admin" : "user",
			can_invite: !!row.can_invite
		},
		session: {
			id: row.session_id,
			kind: row.kind === "api" ? "api" : "session",
			name: row.session_name,
			expires_at: row.expires_at
		}
	};
}

export async function createSession(sql: Sql, userId: number, kind: "session" | "api", name: string | null = null) {
	const { token, hash } = newToken();
	const expiresAt = kind === "session" ? new Date(Date.now() + SESSION_TTL_MS) : null;
	const [row] = await sql`
		insert into sessions ${sql({
			user_id: userId,
			token_hash: hash,
			kind,
			name,
			expires_at: expiresAt,
			last_used_at: new Date()
		})}
		returning id, created_at, expires_at
	`;
	return { token, id: row!.id as number, expiresAt: row!.expires_at as Date | null };
}

export function canInvite(user: AuthUser) {
	return user.role === "admin" || user.can_invite;
}

// Brute-force protection for login, keyed by identifier. In-memory on purpose:
// the dashboard is single-instance and a restart just resets the counters.
const MAX_FREE_ATTEMPTS = 5;
const BASE_LOCK_MS = 30 * 1000;
const attempts = new Map<string, { failures: number, lockedUntil: number }>();

export function loginLockedFor(key: string): number {
	const entry = attempts.get(key);
	if (!entry) return 0;
	return Math.max(0, entry.lockedUntil - Date.now());
}

export function loginFailed(key: string) {
	const entry = attempts.get(key) ?? { failures: 0, lockedUntil: 0 };
	entry.failures += 1;
	if (entry.failures >= MAX_FREE_ATTEMPTS) {
		const factor = 2 ** Math.min(entry.failures - MAX_FREE_ATTEMPTS, 6);
		entry.lockedUntil = Date.now() + BASE_LOCK_MS * factor;
	}
	attempts.set(key, entry);
}

export function loginSucceeded(key: string) {
	attempts.delete(key);
}
