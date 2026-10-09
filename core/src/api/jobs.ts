import { Elysia, t } from "elysia";
import { listJobs, getJob, createJob, updateJob, deleteJob, runJob, validateSchedule, type JobInput } from "../services/jobs.ts";
import { PublishParamsSchema } from "./publish.ts";
import { authorized } from "./authorized.ts";

const JobBody = t.Object({
	name: t.String({ maxLength: 64 }),
	cron: t.String({ minLength: 1, maxLength: 64 }),
	timezone: t.Optional(t.String({ maxLength: 64 })),
	enabled: t.Optional(t.Boolean()),
	params: PublishParamsSchema
});
const JobParams = t.Object({ id: t.Numeric() });

function normalize(body: typeof JobBody.static): JobInput {
	return {
		name: body.name.trim() || "job",
		cron: body.cron.trim(),
		timezone: body.timezone?.trim() || "UTC",
		enabled: body.enabled ?? true,
		params: body.params
	};
}

export const jobRoutes = new Elysia()
	.use(authorized)

	.get("/jobs", ({ auth }) => listJobs(auth.user.id), { auth: "user" })

	.post("/jobs", async ({ auth, body, status }) => {
		const input = normalize(body);
		const problem = validateSchedule(input.cron, input.timezone);
		if (problem) return status(400, problem);
		return createJob(auth.user.id, input);
	}, { auth: "user", body: JobBody })

	.put("/jobs/:id", async ({ auth, params, body, status }) => {
		const input = normalize(body);
		const problem = validateSchedule(input.cron, input.timezone);
		if (problem) return status(400, problem);
		const updated = await updateJob(auth.user.id, params.id, input);
		if (!updated) return status(404, "No such job");
		return updated;
	}, { auth: "user", params: JobParams, body: JobBody })

	.delete("/jobs/:id", async ({ auth, params, status }) => {
		if (!(await deleteJob(auth.user.id, params.id))) return status(404, "No such job");
		return { ok: true };
	}, { auth: "user", params: JobParams })

	.post("/jobs/:id/run", async ({ auth, params, status }) => {
		const job = await getJob(auth.user.id, params.id);
		if (!job) return status(404, "No such job");
		return { result: await runJob(job.id) };
	}, { auth: "user", params: JobParams });
