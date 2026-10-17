import { mudcrack } from "rampike";
import { api, ok, errorText, el, formatDate, safe } from "./utils/utils";
import { pullCurtain } from "./utils/curtain";
import { report } from "./utils/console";

const FLAGS = ["doubletap", "keep", "markdownlinks", "sfw", "nsfw", "useproxy"] as const;
type Flag = typeof FLAGS[number];

type PublishParams = {
	target: string,
	count?: number,
	flags?: Flag[],
	extras?: Record<string, unknown>
};
type Job = {
	id: number,
	name: string,
	cron: string,
	timezone: string,
	enabled: boolean,
	params: PublishParams,
	last_run_at: string | null,
	last_result: string | null,
	next_run: string | null
};
type JobInput = Omit<Job, "id" | "last_run_at" | "last_result" | "next_run">;

let editing: Job | null = null;

const browserTimezone = () => safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";

export function initJobs() {
	el("#job-flags")?.replaceChildren(...FLAGS.map(flag => mudcrack({
		tagName: "label",
		className: "row-compact baseline pointer",
		contents: [
			mudcrack({ tagName: "input", attributes: { type: "checkbox", "data-flag": flag } }),
			mudcrack({ tagName: "span", contents: flag })
		]
	})));

	const timezone = el<HTMLInputElement>("#job-timezone");
	if (timezone) timezone.placeholder = browserTimezone();

	el("#job-form")?.addEventListener("submit", e => {
		e.preventDefault();
		saveJob();
	});
	el("#job-cancel")?.addEventListener("click", () => setEditing(null));
}

function readForm(): JobInput | null {
	const name = el<HTMLInputElement>("#job-name")?.value.trim() ?? "";
	const cron = el<HTMLInputElement>("#job-cron")?.value.trim() ?? "";
	const timezone = el<HTMLInputElement>("#job-timezone")?.value.trim() || browserTimezone();
	const target = el<HTMLInputElement>("#job-target")?.value.trim() ?? "";
	const count = parseInt(el<HTMLInputElement>("#job-count")?.value ?? "1", 10) || 1;
	const enabled = el<HTMLInputElement>("#job-enabled")?.checked ?? true;
	const extrasRaw = el<HTMLTextAreaElement>("#job-extras")?.value.trim() ?? "";

	if (!cron) { report("A cron pattern is required"); return null; }
	if (!target) { report("A telegram target is required"); return null; }

	let extras: Record<string, unknown> | undefined;
	if (extrasRaw) {
		const parsed = safe(() => JSON.parse(extrasRaw));
		if (!parsed || typeof parsed !== "object") { report("Extras must be a JSON object"); return null; }
		extras = parsed;
	}

	const flags = Array.from(document.querySelectorAll<HTMLInputElement>("#job-flags input:checked"))
		.map(box => box.dataset.flag as Flag);

	return {
		name: name || `${target} ${cron}`,
		cron,
		timezone,
		enabled,
		params: { target, count, ...(flags.length ? { flags } : {}), ...(extras ? { extras } : {}) }
	};
}

function fillForm(job: Job | null) {
	const set = (query: string, value: string) => { const e = el<HTMLInputElement | HTMLTextAreaElement>(query); if (e) e.value = value; };
	set("#job-name", job?.name ?? "");
	set("#job-cron", job?.cron ?? "");
	set("#job-timezone", job?.timezone ?? "");
	set("#job-target", job?.params.target ?? "");
	set("#job-count", `${job?.params.count ?? 1}`);
	set("#job-extras", job?.params.extras ? JSON.stringify(job.params.extras, null, "\t") : "");
	const enabled = el<HTMLInputElement>("#job-enabled");
	if (enabled) enabled.checked = job?.enabled ?? true;
	document.querySelectorAll<HTMLInputElement>("#job-flags input").forEach(box => {
		box.checked = !!job?.params.flags?.includes(box.dataset.flag as Flag);
	});
}

function setEditing(job: Job | null) {
	editing = job;
	fillForm(job);
	const title = el("#job-form-title");
	if (title) title.textContent = job ? `editing "${job.name}" (#${job.id})` : "new job";
	const save = el("#job-save");
	if (save) save.textContent = job ? "save changes" : "create job";
	const cancel = el("#job-cancel");
	if (cancel) cancel.hidden = !job;
	if (job) el("#job-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveJob() {
	const input = readForm();
	if (!input) return;

	pullCurtain(true, editing ? "Saving job" : "Creating job");
	const response = editing
		? await api.put<Job>(`/api/jobs/${editing.id}`, input)
		: await api.post<Job>("/api/jobs", input);
	pullCurtain(false);

	if (!ok(response)) {
		report(`Job not saved: ${errorText(response)}`);
		return;
	}
	report(editing ? `Job #${response.data.id} updated` : `Job #${response.data.id} created, next run ${formatDate(response.data.next_run)}`);
	setEditing(null);
	loadJobs();
}

export async function loadJobs() {
	const list = el("#jobs-list");
	if (!list) return;

	const response = await api.get<Job[]>("/api/jobs");
	if (!ok(response)) return;

	list.replaceChildren(...(response.data.length === 0
		? [mudcrack({ className: "hint", contents: "no jobs yet" })]
		: response.data.map(renderJob)
	));
}

function describeParams(params: PublishParams) {
	return [
		`→ ${params.target}`,
		`count ${params.count ?? 1}`,
		params.flags?.length ? params.flags.join(", ") : "no flags",
		params.extras ? "with extras" : null
	].filter(Boolean).join(" · ");
}

async function runJob(job: Job) {
	pullCurtain(true, `Running "${job.name}"`);
	const response = await api.post<{ result: string }>(`/api/jobs/${job.id}/run`);
	pullCurtain(false);
	report(ok(response) ? `"${job.name}": ${response.data.result}` : `Run failed: ${errorText(response)}`);
	loadJobs();
}

async function toggleJob(job: Job) {
	pullCurtain(true);
	const response = await api.put(`/api/jobs/${job.id}`, { ...job, enabled: !job.enabled });
	pullCurtain(false);
	if (!ok(response)) report(`Update failed: ${errorText(response)}`);
	loadJobs();
}

async function deleteJob(job: Job) {
	if (!confirm(`Delete job "${job.name}"?`)) return;
	pullCurtain(true);
	const response = await api.del(`/api/jobs/${job.id}`);
	pullCurtain(false);
	if (!ok(response)) report(`Delete failed: ${errorText(response)}`);
	if (editing?.id === job.id) setEditing(null);
	loadJobs();
}

function renderJob(job: Job) {
	const action = (caption: string, handler: () => void) => mudcrack({
		tagName: "button",
		className: "lineout",
		contents: caption,
		events: { click: handler }
	});

	return mudcrack({
		className: "lineout job-item list",
		attributes: { "data-enabled": `${job.enabled}` },
		contents: [
			mudcrack({
				className: "row-wrap baseline",
				contents: [
					mudcrack({ tagName: "span", className: "job-name", contents: job.name }),
					mudcrack({ tagName: "code", contents: `${job.cron} ${job.timezone}` }),
					mudcrack({
						tagName: "span",
						className: job.enabled ? "tag tag-ok" : "tag",
						contents: job.enabled ? `next ${formatDate(job.next_run)}` : "disabled"
					})
				]
			}),
			mudcrack({ className: "hint", contents: describeParams(job.params) }),
			mudcrack({
				className: "hint",
				contents: job.last_run_at ? `last run ${formatDate(job.last_run_at)}: ${job.last_result ?? "?"}` : "never ran"
			}),
			mudcrack({
				className: "row-wrap",
				contents: [
					action("run now", () => runJob(job)),
					action(job.enabled ? "disable" : "enable", () => toggleJob(job)),
					action("edit", () => setEditing(job)),
					action("delete", () => deleteJob(job))
				]
			})
		]
	});
}
