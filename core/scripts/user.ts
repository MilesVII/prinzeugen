import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../src/auth.ts";

const USAGE = `
usage:
  bun run user list
  bun run user create <name> [--admin] [--invite] [--password <pw>]
  bun run user passwd <id|name> [--password <pw>]
  bun run user grant  <id|name> [--admin|--no-admin] [--invite|--no-invite]
  bun run user revoke-sessions <id|name>

When --password is omitted a random one is generated and printed.
`.trim();

const connection = Bun.env.DB_CONNECTION;
if (!connection) {
	console.error("DB_CONNECTION is not set (put it in .env at the repository root)");
	process.exit(1);
}

const [command, target, ...rest] = Bun.argv.slice(2);
const flags = new Set(rest.filter(a => a.startsWith("--")));
function flagValue(name: string) {
	const index = rest.indexOf(name);
	return index >= 0 ? rest[index + 1] : undefined;
}

const sql = postgres(connection);

async function findUser(ref: string) {
	const asId = /^\d+$/.test(ref) ? parseInt(ref, 10) : null;
	const rows = asId !== null
		? await sql`select id, name, role, can_invite from users where id = ${asId}`
		: await sql`select id, name, role, can_invite from users where name = ${ref} limit 2`;
	if (rows.length !== 1) {
		console.error(rows.length === 0 ? `no user matches "${ref}"` : `"${ref}" is ambiguous, use the id`);
		process.exit(1);
	}
	return rows[0]!;
}

function pickPassword() {
	const given = flagValue("--password");
	if (given) {
		if (given.length < MIN_PASSWORD_LENGTH) {
			console.error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
			process.exit(1);
		}
		return { password: given, generated: false };
	}
	return { password: randomBytes(12).toString("base64url"), generated: true };
}

try {
	switch (command) {
		case "list": {
			const rows = await sql`
				select u.id, u.name, u.role, u.can_invite, u.created_at,
					(u.access_token is not null) as has_password,
					(select count(*) from sessions s where s.user_id = u.id) as sessions
				from users u order by u.id
			`;
			console.table(rows.map(r => ({ ...r, sessions: Number(r.sessions) })));
			break;
		}
		case "create": {
			if (!target) throw new Error(USAGE);
			const { password, generated } = pickPassword();
			const [row] = await sql`
				insert into users ${sql({
					name: target,
					access_token: await hashPassword(password),
					role: flags.has("--admin") ? "admin" : "user",
					can_invite: flags.has("--invite") || flags.has("--admin"),
					grabbers: [],
					additional: ""
				})}
				returning id, name, role, can_invite
			`;
			console.log(`created user #${row!.id} "${row!.name}" (${row!.role}${row!.can_invite ? ", can invite" : ""})`);
			if (generated) console.log(`password: ${password}`);
			break;
		}
		case "passwd": {
			if (!target) throw new Error(USAGE);
			const user = await findUser(target);
			const { password, generated } = pickPassword();
			await sql`update users set access_token = ${await hashPassword(password)} where id = ${user.id}`;
			await sql`delete from sessions where user_id = ${user.id} and kind = 'session'`;
			console.log(`password updated for #${user.id} "${user.name}", browser sessions revoked`);
			if (generated) console.log(`password: ${password}`);
			break;
		}
		case "grant": {
			if (!target) throw new Error(USAGE);
			const user = await findUser(target);
			const delta: Record<string, unknown> = {};
			if (flags.has("--admin")) delta.role = "admin";
			if (flags.has("--no-admin")) delta.role = "user";
			if (flags.has("--invite")) delta.can_invite = true;
			if (flags.has("--no-invite")) delta.can_invite = false;
			if (Object.keys(delta).length === 0) throw new Error(USAGE);
			const [row] = await sql`update users set ${sql(delta)} where id = ${user.id} returning id, name, role, can_invite`;
			console.log(`#${row!.id} "${row!.name}" is now ${row!.role}${row!.can_invite ? ", can invite" : ""}`);
			break;
		}
		case "revoke-sessions": {
			if (!target) throw new Error(USAGE);
			const user = await findUser(target);
			const deleted = await sql`delete from sessions where user_id = ${user.id} returning id`;
			console.log(`revoked ${deleted.length} session(s) and api token(s) of #${user.id}`);
			break;
		}
		default:
			console.log(USAGE);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await sql.end();
}
