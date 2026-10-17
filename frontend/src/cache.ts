import { api, ok, errorText, el, formatDate } from "./utils/utils";
import { pullCurtain } from "./utils/curtain";
import { report } from "./utils/console";

type CacheOverview = {
	worker: {
		enabled: boolean,
		busy: boolean,
		intervalSec: number,
		batch: number,
		currentPostId: string | null,
		lastCheckAt: string | null,
		lastCachedAt: string | null,
		lastError: string | null,
		cachedSinceStart: number,
		failedSinceStart: number
	},
	counts: { cached: number, samples: number, originals: number, queued: number, failed: number },
	storage: {
		dir: string,
		disk: { total: number, free: number, used: number },
		cache: { files: number, bytes: number },
		database: { bytes: number }
	}
};

const POLL_MS = 10_000;
let pollTimer: number | null = null;
let current: CacheOverview | null = null;

export function formatBytes(bytes: number) {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function initCache() {
	el("#cache-toggle")?.addEventListener("click", toggle);
	el("#cache-retry")?.addEventListener("click", retry);
	el("#cache-reconcile")?.addEventListener("click", reconcile);
	el("#cache-refresh")?.addEventListener("click", () => loadCache());
}

function dashboardVisible() {
	const tabs = document.querySelector<HTMLElement & { tab: string }>("#tabs-main");
	return document.visibilityState === "visible" && tabs?.tab === "dash";
}

function schedulePoll() {
	if (pollTimer !== null) window.clearTimeout(pollTimer);
	pollTimer = window.setTimeout(() => {
		pollTimer = null;
		if (current?.worker.enabled && dashboardVisible())
			loadCache();
		else
			schedulePoll();
	}, POLL_MS);
}

export async function loadCache() {
	const response = await api.get<CacheOverview>("/api/cache");
	if (!ok(response)) return;
	render(response.data);
	schedulePoll();
}

function setText(query: string, text: string) {
	const target = el(query);
	if (target) target.textContent = text;
}

function render(data: CacheOverview) {
	current = data;
	const { worker, counts, storage } = data;

	const state = el("#cache-state");
	if (state) {
		state.textContent = !worker.enabled ? "stopped" : worker.busy ? "downloading" : "idle";
		state.classList.toggle("tag-ok", worker.enabled);
	}
	const toggleButton = el("#cache-toggle");
	if (toggleButton) toggleButton.textContent = worker.enabled ? "stop" : "start";

	setText("#cache-worker", [
		worker.currentPostId ? `downloading #${worker.currentPostId}` : null,
		`checks every ${worker.intervalSec}s, up to ${worker.batch} per check`,
		`last check ${formatDate(worker.lastCheckAt)}`,
		`since start: ${worker.cachedSinceStart} cached, ${worker.failedSinceStart} failed`
	].filter(Boolean).join(" · "));
	const lastError = el("#cache-error");
	if (lastError) {
		lastError.textContent = worker.lastError ? `last error: ${worker.lastError}` : "";
		lastError.hidden = !worker.lastError;
	}

	setText("#cache-counts", [
		`${counts.cached} cached (${counts.samples} samples, ${counts.originals} originals)`,
		`${counts.queued} queued`,
		`${counts.failed} gave up`
	].join(" · "));

	const { disk, cache, database } = storage;
	const bar = el<HTMLProgressElement>("#cache-disk-bar");
	if (bar) {
		bar.max = disk.total || 1;
		bar.value = disk.used;
	}
	const usedShare = disk.total ? Math.round(disk.used / disk.total * 100) : 0;
	setText("#cache-disk", `disk: ${formatBytes(disk.used)} of ${formatBytes(disk.total)} used (${usedShare}%), ${formatBytes(disk.free)} free`);
	setText("#cache-sizes", `cache: ${formatBytes(cache.bytes)} in ${cache.files} files · database: ${formatBytes(database.bytes)} · ${storage.dir}`);

	const retryButton = el<HTMLButtonElement>("#cache-retry");
	if (retryButton) retryButton.disabled = counts.failed === 0;
}

async function toggle() {
	const starting = !current?.worker.enabled;
	pullCurtain(true, starting ? "Starting cache worker" : "Stopping cache worker");
	const response = await api.post<CacheOverview>(starting ? "/api/cache/start" : "/api/cache/stop");
	pullCurtain(false);
	if (!ok(response)) {
		report(`Cache worker: ${errorText(response)}`);
		return;
	}
	render(response.data);
	report(`Cache worker ${starting ? "started" : "stopped"}`);
	schedulePoll();
}

async function retry() {
	pullCurtain(true);
	const response = await api.post<{ reset: number }>("/api/cache/retry");
	pullCurtain(false);
	report(ok(response) ? `${response.data.reset} failed post(s) queued again` : `Retry failed: ${errorText(response)}`);
	loadCache();
}

async function reconcile() {
	pullCurtain(true, "Checking cache files");
	const response = await api.post<{ removedFiles: number, removedPartials: number, forgottenRows: number }>("/api/cache/reconcile");
	pullCurtain(false);
	if (ok(response)) {
		const r = response.data;
		report(`Cache reconciled: ${r.removedFiles} orphan file(s) and ${r.removedPartials} partial download(s) removed, ${r.forgottenRows} missing file(s) forgotten`);
	} else {
		report(`Reconcile failed: ${errorText(response)}`);
	}
	loadCache();
}
