import { Elysia, t } from "elysia";
import { publish, PUB_FLAGS } from "../services/publish.ts";
import { authorized } from "./authorized.ts";

export const publishRoutes = new Elysia()
	.use(authorized)

	.post("/publish", async ({ auth, body, status }) => {
		const outcome = await publish(auth.user.id, body);
		if (outcome.status === "bad-target") return status(400, "Can't parse telegram target");
		if (outcome.status === "empty") return status(404, "No scheduled posts for this user");
		return outcome;
	}, {
		auth: "user",
		body: t.Object({
			target: t.String(),
			id: t.Optional(t.Integer()),
			flags: t.Optional(t.Array(t.Union(PUB_FLAGS.map(flag => t.Literal(flag))))),
			count: t.Optional(t.Integer({ minimum: 1, maximum: 50 })),
			extras: t.Optional(t.Object({
				customMarkup: t.Optional(t.Any()),
				extraLink: t.Optional(t.Union([
					t.String(),
					t.Object({ text: t.String(), url: t.String() })
				]))
			}))
		})
	});
