import { Elysia, t } from "elysia";
import { opsStatus, runOp, OP_NAMES } from "../services/ops.ts";
import { authorized } from "./authorized.ts";

export const opsRoutes = new Elysia()
	.use(authorized)

	.get("/ops", () => opsStatus(), { auth: "admin" })

	.post("/ops/:name/run", async ({ params, status }) => {
		const outcome = await runOp(params.name);
		if (!outcome.started) return status(409, outcome.reason ?? "Could not start");
		return outcome;
	}, {
		auth: "admin",
		params: t.Object({ name: t.Union(OP_NAMES.map(name => t.Literal(name))) })
	});
