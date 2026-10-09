import { api, ok, errorText, el, fromTemplateFirst, formatDate, safe } from "./utils/utils";
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
	const flags = el("#job-flags");
	if (flags) {
		flags.innerHTML = "";
		FLAGS.forEach(flag => {
			const label = document.createElement("label");
			label.className = "row-compact baseline pointer";
			const box = document.createElement("input");
			box.type = "checkbox";
			box.dataset.flag = flag;
			const text = document.createElement("span");
			text.textContent = flag;
			label.append(box, text);
			flags.append(label);
		});
	}

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

	list.innerHTML = "";
	if (response.data.length === 0) {
		const empty = document.createElement("div");
		empty.className = "hint";
		empty.textContent = "no jobs yet";
		list.append(empty);
		return;
	}
	response.data.forEach(job => {
		const item = renderJob(job);
		if (item) list.append(item);
	});
}

function describeParams(params: PublishParams) {
	return [
		`→ ${params.target}`,
		`count ${params.count ?? 1}`,
		params.flags?.length ? params.flags.join(", ") : "no flags",
		params.extras ? "with extras" : null
	].filter(Boolean).join(" · ");
}

function renderJob(job: Job) {
	const item = fromTemplateFirst("template-job-item");
	if (!item) return null;
	item.dataset.enabled = `${job.enabled}`;

	const field = (name: string) => item.querySelector<HTMLElement>(`[data-field=${name}]`);
	const name = field("name");
	if (name) name.textContent = job.name;
	const cron = field("cron");
	if (cron) cron.textContent = `${job.cron} ${job.timezone}`;
	const state = field("state");
	if (state) {
		state.textContent = job.enabled ? `next ${formatDate(job.next_run)}` : "disabled";
		state.classList.toggle("tag-ok", job.enabled);
	}
	const meta = field("meta");
	if (meta) meta.textContent = describeParams(job.params);
	const last = field("last");
	if (last) last.textContent = job.last_run_at ? `last run ${formatDate(job.last_run_at)}: ${job.last_result ?? "?"}` : "never ran";

	const action = (name: string, handler: () => void) =>
		item.querySelector(`[data-action=${name}]`)?.addEventListener("click", handler);

	action("run", async () => {
		pullCurtain(true, `Running "${job.name}"`);
		const response = await api.post<{ result: string }>(`/api/jobs/${job.id}/run`);
		pullCurtain(false);
		report(ok(response) ? `"${job.name}": ${response.data.result}` : `Run failed: ${errorText(response)}`);
		loadJobs();
	});
	const toggle = item.querySelector<HTMLButtonElement>("[data-action=toggle]");
	if (toggle) toggle.textContent = job.enabled ? "disable" : "enable";
	action("toggle", async () => {
		pullCurtain(true);
		const response = await api.put(`/api/jobs/${job.id}`, { ...job, enabled: !job.enabled });
		pullCurtain(false);
		if (!ok(response)) report(`Update failed: ${errorText(response)}`);
		loadJobs();
	});
	action("edit", () => setEditing(job));
	action("delete", async () => {
		if (!confirm(`Delete job "${job.name}"?`)) return;
		pullCurtain(true);
		const response = await api.del(`/api/jobs/${job.id}`);
		pullCurtain(false);
		if (!ok(response)) report(`Delete failed: ${errorText(response)}`);
		if (editing?.id === job.id) setEditing(null);
		loadJobs();
	});

	return item;
}
