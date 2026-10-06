import { Elysia, t } from "elysia";
import { getApproved, getModerables, moderate, wipePool, unschedulePost, unfailPost } from "../services/pool.ts";
import { authorized } from "./authorized.ts";

const poolId = t.Object({ id: t.String({ pattern: "^\\d+$" }) });

export const poolRoutes = new Elysia()
	.use(authorized)

	.get("/moderables", ({ auth }) => getModerables(auth.user.id), { auth: "user" })

	.post("/moderate", async ({ auth, body }) => {
		await moderate(auth.user.id, body.decisions);
		return getModerables(auth.user.id);
	}, {
		auth: "user",
		body: t.Object({
			decisions: t.Array(t.Object({
				id: t.Number(),
				approved: t.Boolean()
			}))
		})
	})

	.get("/pool", ({ auth, query }) => {
		const stride = Math.min(Math.max(query.stride ?? 100, 1), 500);
		const page = Math.max(query.page ?? 0, 0);
		return getApproved(auth.user.id, stride, page * stride);
	}, {
		auth: "user",
		query: t.Object({
			page: t.Optional(t.Numeric()),
			stride: t.Optional(t.Numeric())
		})
	})

	.delete("/pool", async ({ auth }) => {
		await wipePool(auth.user.id);
		return { ok: true };
	}, { auth: "user" })

	.delete("/pool/:id", async ({ auth, params }) => {
		await unschedulePost(auth.user.id, params.id);
		return { ok: true };
	}, { auth: "user", params: poolId })

	.post("/pool/:id/unfail", async ({ auth, params }) => {
		await unfailPost(auth.user.id, params.id);
		return { ok: true };
	}, { auth: "user", params: poolId });
