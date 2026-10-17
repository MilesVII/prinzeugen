import { sql } from "../db.ts";
import { env } from "../env.ts";
import { sleep } from "../utils.ts";
import type { MessageV4 } from "../grabbers/message.ts";
import { getSetting, setSetting } from "./settings.ts";
import {
	downloadToCache, removeCacheFiles, reconcileCache,
	TransientError, PermanentError, MAX_CACHE_ATTEMPTS
} from "./media.ts";

// One background loop for the whole server. Every check it takes up to CACHE_BATCH posts
// pending moderation that aren't cached yet and downloads them strictly one after another.

const SETTING_KEY = "cache_worker";
const PAUSE_BETWEEN_DOWNLOADS_MS = 1500;

let enabled = false;
let busy = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;

const stats = {
	currentPostId: null as string | null,
	lastCheckAt: null as Date | null,
	lastCachedAt: null as Date | null,
	lastError: null as string | null,
	cachedSinceStart: 0,
	failedSinceStart: 0
};

type Outcome = "cached" | "failed" | "transient" | "aborted" | "gone";

async function cachePost(id: string, message: MessageV4): Promise<Outcome> {
	stats.currentPostId = id;
	controller = new AbortController();
	try {
		const media = await downloadToCache(id, message, controller.signal);
		const updated = await sql`
			update pool set cache_file = ${media.file}, cache_variant = ${media.variant}, cache_error = null
				where id = ${id}
				returning id
		`;
		if (updated.length === 0) {
			// rejected or published while downloading
			await removeCacheFiles([media.file]);
			return "gone";
		}
		stats.cachedSinceStart += 1;
		stats.lastCachedAt = new Date();
		return "cached";
	} catch (error) {
		if (controller?.signal.aborted) return "aborted";

		const reason = error instanceof Error ? error.message : String(error);
		const attempts = error instanceof PermanentError ? MAX_CACHE_ATTEMPTS : null;
		await sql`
			update pool set
				cache_attempts = ${attempts === null ? sql`cache_attempts + 1` : attempts},
				cache_error = ${reason.slice(0, 500)}
			where id = ${id}
		`;
		stats.failedSinceStart += 1;
		stats.lastError = `#${id}: ${reason}`;
		return error instanceof TransientError ? "transient" : "failed";
	} finally {
		controller = null;
		stats.currentPostId = null;
	}
}

async function check() {
	timer = null;
	if (!enabled || busy) return;

	busy = true;
	stats.lastCheckAt = new Date();
	try {
		const rows = await sql<{ id: string, message: MessageV4 }[]>`
			select id::text, message from pool
				where approved is null and cache_file is null
					and cache_attempts < ${MAX_CACHE_ATTEMPTS}
					and (message->>'version')::int = 4
				order by id asc
				limit ${env.cacheBatch}
		`;
		for (const [index, row] of rows.entries()) {
			if (!enabled) break;
			const outcome = await cachePost(row.id, row.message);
			if (outcome === "transient" || outcome === "aborted") break;
			if (index < rows.length - 1) await sleep(PAUSE_BETWEEN_DOWNLOADS_MS);
		}
	} catch (error) {
		stats.lastError = error instanceof Error ? error.message : String(error);
		console.error("cache worker check failed", error);
	} finally {
		busy = false;
		if (enabled) schedule(env.cacheIntervalMs);
	}
}

function schedule(delay: number) {
	if (timer) clearTimeout(timer);
	timer = setTimeout(check, delay);
}

export async function initCacheWorker() {
	const saved = await getSetting<{ enabled: boolean } | null>(SETTING_KEY, null);
	enabled = saved?.enabled ?? env.cacheWorkerDefault;
	await reconcileCache().catch(error => console.error("cache reconcile failed", error));
	if (enabled) schedule(2000);
	console.log(`cache worker: ${enabled ? "running" : "stopped"}, dir ${env.cacheDir}`);
}

export async function startCacheWorker() {
	enabled = true;
	await setSetting(SETTING_KEY, { enabled: true });
	if (!busy) schedule(0);
}

export async function stopCacheWorker() {
	enabled = false;
	await setSetting(SETTING_KEY, { enabled: false });
	if (timer) clearTimeout(timer);
	timer = null;
	controller?.abort();
}

export function cacheWorkerStatus() {
	return {
		enabled,
		busy,
		intervalSec: env.cacheIntervalMs / 1000,
		batch: env.cacheBatch,
		...stats
	};
}
