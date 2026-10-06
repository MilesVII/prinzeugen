import { Elysia, t } from "elysia";
import { GrabberConfigSchema } from "../grabbers/index.ts";
import { getGrabbers, setGrabbers, grab } from "../services/pool.ts";
import { authorized } from "./authorized.ts";

export const grabberRoutes = new Elysia()
	.use(authorized)

	.get("/grabbers", ({ auth }) => getGrabbers(auth.user.id), { auth: "user" })

	.put("/grabbers", async ({ auth, body }) => {
		await setGrabbers(auth.user.id, body);
		return getGrabbers(auth.user.id);
	}, {
		auth: "user",
		body: t.Array(GrabberConfigSchema)
	})

	.post("/grab", async ({ auth, body, status }) => {
		const added = await grab(auth.user.id, body.id, body.batchLimit);
		if (added === null) return status(404, "No such grabber");
		return { added };
	}, {
		auth: "user",
		body: t.Object({
			id: t.Optional(t.Integer({ minimum: 0 })),
			batchLimit: t.Optional(t.Integer({ minimum: 1, maximum: 1000 }))
		})
	});
