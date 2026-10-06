import { Elysia } from "elysia";
import { sql } from "../db.ts";
import { resolveAuth, extractBearer, canInvite } from "../auth.ts";

export type AccessLevel = "user" | "invite" | "admin";

/**
 * Route option `auth: "user" | "invite" | "admin"` resolves the bearer token into `auth`
 * on the handler context, or short-circuits with 401/403.
 */
export const authorized = new Elysia({ name: "authorized" })
	.macro({
		auth: (level: AccessLevel) => ({
			resolve: async ({ headers, status }) => {
				const auth = await resolveAuth(sql, extractBearer(headers.authorization));
				if (!auth) return status(401, "Not authorized");
				if (level === "admin" && auth.user.role !== "admin") return status(403, "Admins only");
				if (level === "invite" && !canInvite(auth.user)) return status(403, "You are not allowed to create users");
				return { auth };
			}
		})
	});
