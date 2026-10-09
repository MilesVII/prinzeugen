import { Elysia } from "elysia";
import { accountRoutes } from "./account.ts";
import { grabberRoutes } from "./grabbers.ts";
import { poolRoutes } from "./pool.ts";
import { publishRoutes } from "./publish.ts";
import { jobRoutes } from "./jobs.ts";
import { opsRoutes } from "./ops.ts";

export const api = new Elysia({ prefix: "/api" })
	.get("/debug", () => ({ ok: true }))
	.use(accountRoutes)
	.use(grabberRoutes)
	.use(poolRoutes)
	.use(publishRoutes)
	.use(jobRoutes)
	.use(opsRoutes);
