import { Elysia, t } from "elysia";
import { sql, type ApiTokenRow } from "../db.ts";
import {
	hashPassword, verifyPassword, createSession,
	loginLockedFor, loginFailed, loginSucceeded, MIN_PASSWORD_LENGTH
} from "../auth.ts";
import { findUserById, findUserByIdentifier, userBundle } from "../services/users.ts";
import { authorized } from "./authorized.ts";

// Keeps login timing flat when the user does not exist
const DUMMY_HASH = await hashPassword("definitely-not-a-real-password");

export const accountRoutes = new Elysia()
	.use(authorized)

	.post("/login", async ({ body, status }) => {
		const key = String(body.identifier).trim().toLowerCase();
		const locked = loginLockedFor(key);
		if (locked > 0)
			return status(429, `Too many attempts, retry in ${Math.ceil(locked / 1000)}s`);

		const found = await findUserByIdentifier(body.identifier);
		const check = await verifyPassword(body.password, found ? found.access_token : DUMMY_HASH);
		if (!found || check === "fail") {
			loginFailed(key);
			return status(401, "Wrong login or password");
		}
		loginSucceeded(key);

		if (check === "legacy") {
			found.access_token = await hashPassword(body.password);
			await sql`update users set access_token = ${found.access_token} where id = ${found.id}`;
		}

		const session = await createSession(sql, Number(found.id), "session");
		return {
			token: session.token,
			expiresAt: session.expiresAt,
			...(await userBundle(found))
		};
	}, {
		body: t.Object({
			identifier: t.Union([t.String(), t.Number()]),
			password: t.String()
		})
	})

	.get("/me", async ({ auth, status }) => {
		const user = await findUserById(auth.user.id);
		if (!user) return status(401, "Not authorized");
		return userBundle(user);
	}, { auth: "user" })

	.post("/logout", async ({ auth }) => {
		await sql`delete from sessions where id = ${auth.session.id}`;
		return { ok: true };
	}, { auth: "user" })

	.post("/password", async ({ auth, body, status }) => {
		const [row] = await sql`select access_token from users where id = ${auth.user.id}`;
		const check = await verifyPassword(body.currentPassword, row?.access_token);
		if (check === "fail") return status(403, "Current password is wrong");

		await sql.begin(async sql => {
			await sql`update users set access_token = ${await hashPassword(body.newPassword)} where id = ${auth.user.id}`;
			await sql`delete from sessions where user_id = ${auth.user.id} and kind = 'session' and id <> ${auth.session.id}`;
		});
		return { ok: true };
	}, {
		auth: "user",
		body: t.Object({
			currentPassword: t.String(),
			newPassword: t.String({ minLength: MIN_PASSWORD_LENGTH })
		})
	})

	.patch("/settings", async ({ auth, body }) => {
		const delta: Record<string, string> = {};
		if (body.tgToken !== undefined) delta.tg_token = body.tgToken;
		if (body.additional !== undefined) delta.additional = body.additional;
		if (Object.keys(delta).length > 0)
			await sql`update users set ${sql(delta)} where id = ${auth.user.id}`;
		return { ok: true };
	}, {
		auth: "user",
		body: t.Object({
			tgToken: t.Optional(t.String()),
			additional: t.Optional(t.String())
		})
	})

	.get("/tokens", ({ auth }) => sql<ApiTokenRow[]>`
		select id, name, created_at, last_used_at
			from sessions
			where user_id = ${auth.user.id} and kind = 'api'
			order by id asc
	`, { auth: "user" })

	.post("/tokens", async ({ auth, body }) => {
		const name = body.name.trim() || "api";
		const session = await createSession(sql, auth.user.id, "api", name);
		return { id: session.id, name, token: session.token };
	}, {
		auth: "user",
		body: t.Object({ name: t.String({ maxLength: 64 }) })
	})

	.delete("/tokens/:id", async ({ auth, params }) => {
		await sql`delete from sessions where id = ${params.id} and user_id = ${auth.user.id} and kind = 'api'`;
		return { ok: true };
	}, {
		auth: "user",
		params: t.Object({ id: t.Numeric() })
	})

	.get("/users", () => sql`
		select id::int, name, role, can_invite, created_at, (access_token is not null) as has_password
			from users
			order by id asc
	`, { auth: "admin" })

	.post("/users", async ({ auth, body, status }) => {
		if (auth.user.role !== "admin" && (body.admin || body.canInvite))
			return status(403, "Only admins can grant permissions");

		const name = body.name.trim();
		if (!name) return status(400, "Name is required");
		if (/^\d+$/.test(name)) return status(400, "Name can't be numeric, it would clash with ids");
		const existing = await sql`select id from users where name = ${name}`;
		if (existing.length > 0) return status(409, "A user with that name already exists");

		const [created] = await sql`
			insert into users ${sql({
				name,
				access_token: await hashPassword(body.password),
				role: body.admin ? "admin" : "user",
				can_invite: !!(body.admin || body.canInvite),
				grabbers: [] as any,
				additional: ""
			})}
			returning id::int, name, role, can_invite, created_at
		`;
		return created!;
	}, {
		auth: "invite",
		body: t.Object({
			name: t.String({ maxLength: 64 }),
			password: t.String({ minLength: MIN_PASSWORD_LENGTH }),
			admin: t.Optional(t.Boolean()),
			canInvite: t.Optional(t.Boolean())
		})
	});
