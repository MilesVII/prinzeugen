import { Cron } from "croner";
import { sql } from "../db.ts";
import { publish, type PublishRequest, type PublishOutcome } from "./publish.ts";
import { tgReport } from "../utils.ts";

export type JobRow = {
	id: number,
	user_id: number | string,
	name: string,
	cron: string,
	timezone: string,
	enabled: boolean,
	params: PublishRequest,
	last_run_at: Date | null,
	last_result: string | null,
	created_at: Date
};
export type JobInput = {
	name: string,
	cron: string,
	timezone: string,
	enabled: boolean,
	params: PublishRequest
};
export type JobView = JobRow & { next_run: Date | null };

/** Returns a problem description, or null when the pattern and timezone are usable */
export function validateSchedule(cron: string, timezone: string): string | null {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone });
	} catch {
		return `Unknown timezone "${timezone}", use an IANA name like Europe/Berlin`;
	}
	try {
		const probe = new Cron(cron, { timezone });
		const next = probe.nextRun();
		probe.stop();
		if (!next) return "This pattern never matches a future time";
	} catch (error) {
		return `Bad cron pattern: ${error instanceof Error ? error.message : String(error)}`;
	}
	return null;
}

function nextRun(job: JobRow): Date | null {
	if (!job.enabled) return null;
	try {
		const probe = new Cron(job.cron, { timezone: job.timezone });
		const next = probe.nextRun();
		probe.stop();
		return next;
	} catch {
		return null;
	}
}

function view(job: JobRow): JobView {
	return { ...job, user_id: Number(job.user_id), next_run: nextRun(job) };
}

// In-memory timers, one per enabled job. The DB row is the source of truth;
// a tick re-reads it, so parameter edits apply without rescheduling.
const timers = new Map<number, Cron>();

function arm(job: JobRow) {
	disarm(job.id);
	if (!job.enabled) return;
	try {
		const timer = new Cron(job.cron, {
			timezone: job.timezone,
			protect: true,
			catch: error => console.error(`job #${job.id} failed`, error)
		}, async () => { await runJob(job.id); });
		timers.set(job.id, timer);
	} catch (error) {
		console.error(`job #${job.id} could not be scheduled`, error);
	}
}

function disarm(id: number) {
	timers.get(id)?.stop();
	timers.delete(id);
}

function describe(outcome: PublishOutcome) {
	switch (outcome.status) {
		case "done": return `published ${outcome.published}, failed ${outcome.failed}`;
		case "empty": return "nothing to publish";
		case "bad-target": return "bad target";
	}
}

/** Executes a job once and records the result on its row. Used by the timer and by "run now". */
export async function runJob(id: number): Promise<string> {
	const [job] = await sql<JobRow[]>`select * from publish_jobs where id = ${id}`;
	if (!job) return "job no longer exists";

	let result: string;
	try {
		result = describe(await publish(Number(job.user_id), job.params));
	} catch (error) {
		result = `error: ${error instanceof Error ? error.message : String(error)}`;
		await tgReport(`Publishing job "${job.name}" (#${job.id}) crashed:\n${result}`).catch(() => {});
	}

	await sql`update publish_jobs set last_run_at = now(), last_result = ${result} where id = ${id}`;
	return result;
}

export async function startScheduler() {
	const jobs = await sql<JobRow[]>`select * from publish_jobs where enabled = true`;
	jobs.forEach(arm);
	console.log(`scheduler: ${jobs.length} publishing job(s) armed`);
}

export async function listJobs(user: number): Promise<JobView[]> {
	const rows = await sql<JobRow[]>`select * from publish_jobs where user_id = ${user} order by id asc`;
	return rows.map(view);
}

export async function getJob(user: number, id: number): Promise<JobRow | null> {
	const [row] = await sql<JobRow[]>`select * from publish_jobs where id = ${id} and user_id = ${user}`;
	return row ?? null;
}

export async function createJob(user: number, input: JobInput): Promise<JobView> {
	const [row] = await sql<JobRow[]>`
		insert into publish_jobs ${sql({
			user_id: user,
			name: input.name,
			cron: input.cron,
			timezone: input.timezone,
			enabled: input.enabled,
			params: sql.json(input.params as any)
		})}
		returning *
	`;
	arm(row!);
	return view(row!);
}

export async function updateJob(user: number, id: number, input: JobInput): Promise<JobView | null> {
	const [row] = await sql<JobRow[]>`
		update publish_jobs set ${sql({
			name: input.name,
			cron: input.cron,
			timezone: input.timezone,
			enabled: input.enabled,
			params: sql.json(input.params as any)
		})}
		where id = ${id} and user_id = ${user}
		returning *
	`;
	if (!row) return null;
	arm(row);
	return view(row);
}

export async function deleteJob(user: number, id: number): Promise<boolean> {
	const deleted = await sql`delete from publish_jobs where id = ${id} and user_id = ${user} returning id`;
	if (deleted.length === 0) return false;
	disarm(id);
	return true;
}
