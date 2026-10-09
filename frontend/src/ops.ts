import { api, ok, errorText, el, formatDate } from "./utils/utils";
import { pullCurtain } from "./utils/curtain";
import { report } from "./utils/console";

type OpStatus = {
	name: string,
	description: string,
	running: boolean,
	startedAt: string | null,
	finishedAt: string | null,
	exitCode: number | null,
	log: { file: string, tail: string } | null
};

const CONFIRMATIONS: Record<string, string> = {
	backup: "Dump the database and send it to Telegram now?",
	deploy: "Pull the latest commit, rebuild, migrate and restart the server? The dashboard will reload once it is back."
};

let pollTimer: number | null = null;

export function initOps() {
	el("#ops-refresh")?.addEventListener("click", () => loadOps());
	document.querySelectorAll<HTMLElement>("[data-op]").forEach(button =>
		button.addEventListener("click", () => trigger(button.dataset.op ?? ""))
	);
}

export async function loadOps() {
	const container = el("#ops-status");
	if (!container) return;

	const response = await api.get<OpStatus[]>("/api/ops");
	if (!ok(response)) {
		// the server is restarting during a deploy, or we are not an admin anymore
		if (response.status === 0 || response.status >= 500) schedulePoll();
		return;
	}

	container.innerHTML = "";
	let anyRunning = false;
	response.data.forEach(op => {
		anyRunning ||= op.running;

		const box = document.createElement("details");
		box.className = "lineout";
		box.open = op.running;

		const summary = document.createElement("summary");
		summary.className = "row-compact baseline";
		const title = document.createElement("span");
		title.textContent = op.name;
		const state = document.createElement("span");
		state.className = "hint";
		state.textContent = op.running
			? `running since ${formatDate(op.startedAt)}`
			: op.finishedAt
				? `finished ${formatDate(op.finishedAt)}, exit ${op.exitCode}`
				: op.log
					? `last log ${op.log.file}`
					: "never ran";
		summary.append(title, state);

		const description = document.createElement("div");
		description.className = "hint";
		description.textContent = op.description;

		const log = document.createElement("pre");
		log.className = "ops-log";
		log.textContent = op.log?.tail || "(no log yet)";

		box.append(summary, description, log);
		container.append(box);
	});

	if (anyRunning) schedulePoll();
}

function schedulePoll(delay = 3000) {
	if (pollTimer !== null) window.clearTimeout(pollTimer);
	pollTimer = window.setTimeout(() => {
		pollTimer = null;
		loadOps();
	}, delay);
}

async function trigger(name: string) {
	if (!name) return;
	if (!confirm(CONFIRMATIONS[name] ?? `Run ${name}?`)) return;

	pullCurtain(true, `Starting ${name}`);
	const response = await api.post<{ started: boolean, log?: string }>(`/api/ops/${name}/run`);
	pullCurtain(false);

	if (!ok(response)) {
		report(`${name} not started: ${errorText(response)}`);
		return;
	}
	report(`${name} started, logging to ${response.data.log ?? "logs/"}`);

	if (name === "deploy") {
		// the server goes away for a bit; reload the page once it answers again
		const started = Date.now();
		const probe = async () => {
			const alive = await fetch("/api/debug").then(r => r.ok).catch(() => false);
			if (alive && Date.now() - started > 8000) {
				window.location.reload();
				return;
			}
			if (Date.now() - started < 5 * 60 * 1000) window.setTimeout(probe, 3000);
		};
		window.setTimeout(probe, 8000);
	}
	schedulePoll(1500);
}
