import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, rename, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "../db.ts";
import { env } from "../env.ts";
import { felch } from "../utils.ts";
import type { MessageV4 } from "../grabbers/message.ts";

const GELBOORU_REFERER = "https://gelbooru.com/";
const USER_AGENT = "prinzeugen-cache/1.0";
const DOWNLOAD_TIMEOUT_MS = 180_000;
export const MAX_CACHE_ATTEMPTS = 3;

/** Cache files are named after the pool row: 12345.jpg */
const CACHE_FILE_PATTERN = /^(\d+)\.([a-z0-9]{1,5})$/;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const MIME_EXTENSIONS: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
	"video/mp4": "mp4",
	"video/webm": "webm"
};

export function isCacheFileName(name: string) {
	return CACHE_FILE_PATTERN.test(name);
}

export function cachePath(file: string) {
	return join(env.cacheDir, file);
}

/** Cached images resize as images; gif and video come out of /resize as mp4 */
export function cachedMediaType(file: string): "img" | "vid" {
	const ext = file.split(".").at(-1) ?? "";
	return IMAGE_EXTENSIONS.has(ext) ? "img" : "vid";
}

export async function ensureCacheDir() {
	await mkdir(env.cacheDir, { recursive: true });
}

export async function removeCacheFiles(files: (string | null | undefined)[]) {
	await Promise.all(files.map(async file => {
		if (!file || !isCacheFileName(file)) return;
		try {
			await unlink(cachePath(file));
		} catch (error: any) {
			if (error?.code !== "ENOENT") console.error(`cache: could not remove ${file}`, error);
		}
	}));
}

// Signed URLs: <img> tags can't send a bearer token, and Telegram fetches fallbacks anonymously.

const SECRET = env.mediaSecret || randomBytes(32).toString("hex");

function sign(file: string) {
	return createHmac("sha256", SECRET).update(file).digest("base64url").slice(0, 22);
}

export function verifyMediaSignature(file: string, signature: string) {
	const expected = Buffer.from(sign(file));
	const given = Buffer.from(signature);
	return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Relative URL for the dashboard */
export function mediaUrl(file: string) {
	return `/media/${file}?sig=${sign(file)}`;
}

/** Absolute, downscaled URL for Telegram; randomized so Telegram doesn't reuse a failed fetch */
export function publicCachedResizeUrl(file: string) {
	return `${env.publicUrl}/resize?cached=${file}&sig=${sign(file)}&randomize=${Math.random()}`;
}

// Gelbooru URLs

/** gelbooru rotates image hosts; these rewrites match what currently resolves */
export function normalizeMediaUrl(url: string) {
	return url
		.replace(/https:\/\/img.\./g, "https://img4.")
		.replace(/video-cdn.\./g, "video-cdn4.");
}

/**
 * Sample URL as the gelbooru site builds it:
 * .../images/ab/cd/abcd1234.png → ...//samples/ab/cd/sample_abcd1234.jpg
 * 404s when the original is small enough to be its own sample.
 */
export function sampleUrl(original: string) {
	return original
		.replace("/images/", "//samples/")
		.replace(/\/([^/?#]+?)(\.[a-z0-9]+)?(?=[?#]|$)/i, "/sample_$1.jpg");
}

// Downloading

/** Gelbooru is struggling (429, 5xx, timeout): stop the batch and try again on the next check */
export class TransientError extends Error {}
/** Will never work for this post: don't retry */
export class PermanentError extends Error {}

/** The served type decides; a sample of a .png post is usually a jpeg */
function extensionFor(url: string, mime: string | null) {
	const bare = mime?.split(";")[0]?.trim().toLowerCase() ?? "";
	if (MIME_EXTENSIONS[bare]) return MIME_EXTENSIONS[bare];
	const fromPath = new URL(url).pathname.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase();
	if (fromPath) return fromPath === "jpeg" ? "jpg" : fromPath;
	return null;
}

async function request(url: string, signal: AbortSignal) {
	try {
		return await felch(url, {
			headers: { "Referer": GELBOORU_REFERER, "User-Agent": USER_AGENT },
			signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)])
		});
	} catch (error) {
		if (signal.aborted) throw error;
		throw new TransientError(`network: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function checkStatus(response: Response, label: string) {
	if (response.status === 429 || response.status >= 500)
		throw new TransientError(`${label}: gelbooru answered ${response.status}`);
	if (!response.ok)
		throw new PermanentError(`${label}: gelbooru answered ${response.status}`);
}

export type CachedMedia = { file: string, variant: "sample" | "original", bytes: number };

/**
 * Downloads the media of a V4 post into the cache. Animated posts use the original,
 * everything else the sample, falling back to the original when the sample doesn't exist.
 */
export async function downloadToCache(id: string, message: MessageV4, signal: AbortSignal): Promise<CachedMedia> {
	const original = normalizeMediaUrl(message.content);
	const animated = !!message.tags?.includes("animated");

	let variant: CachedMedia["variant"] = "original";
	let url = original;
	let response: Response | null = null;

	if (!animated) {
		const sample = sampleUrl(original);
		const attempt = await request(sample, signal);
		if (attempt.status === 404) {
			await attempt.body?.cancel();
		} else {
			checkStatus(attempt, "sample");
			response = attempt;
			variant = "sample";
			url = sample;
		}
	}
	if (!response) {
		response = await request(original, signal);
		checkStatus(response, "original");
	}

	const mime = response.headers.get("content-type");
	if (!mime || !/^(image|video)\//.test(mime)) {
		await response.body?.cancel();
		throw new PermanentError(`unexpected content type ${mime ?? "(none)"} from ${url}`);
	}
	const length = parseInt(response.headers.get("content-length") ?? "0", 10);
	if (length > env.cacheMaxBytes) {
		await response.body?.cancel();
		throw new PermanentError(`too large: ${(length / 1048576).toFixed(1)} MB`);
	}
	const ext = extensionFor(url, mime);
	if (!ext) {
		await response.body?.cancel();
		throw new PermanentError(`can't tell the file type of ${url}`);
	}

	await ensureCacheDir();
	const file = `${id}.${ext}`;
	const partial = cachePath(`${file}.part`);
	try {
		const bytes = await Bun.write(partial, response);
		if (bytes > env.cacheMaxBytes) throw new PermanentError(`too large: ${(bytes / 1048576).toFixed(1)} MB`);
		await rename(partial, cachePath(file));
		return { file, variant, bytes };
	} catch (error) {
		await unlink(partial).catch(() => {});
		throw error;
	}
}

// Storage and housekeeping

export async function cacheCounts() {
	const [row] = await sql`
		select
			count(*) filter (where cache_file is not null) as cached,
			count(*) filter (where cache_variant = 'sample') as samples,
			count(*) filter (where cache_variant = 'original') as originals,
			count(*) filter (
				where approved is null and cache_file is null
					and cache_attempts < ${MAX_CACHE_ATTEMPTS}
					and (message->>'version')::int = 4
			) as queued,
			count(*) filter (where cache_file is null and cache_attempts >= ${MAX_CACHE_ATTEMPTS}) as failed
		from pool
	`;
	return {
		cached: Number(row?.cached ?? 0),
		samples: Number(row?.samples ?? 0),
		originals: Number(row?.originals ?? 0),
		queued: Number(row?.queued ?? 0),
		failed: Number(row?.failed ?? 0)
	};
}

export async function storageStats() {
	await ensureCacheDir();

	const fs = await statfs(env.cacheDir);
	const disk = {
		total: fs.blocks * fs.bsize,
		free: fs.bavail * fs.bsize,
		used: (fs.blocks - fs.bfree) * fs.bsize
	};

	let files = 0;
	let bytes = 0;
	for (const name of await readdir(env.cacheDir)) {
		if (!isCacheFileName(name)) continue;
		const info = await stat(cachePath(name)).catch(() => null);
		if (!info?.isFile()) continue;
		files += 1;
		bytes += info.size;
	}

	const [db] = await sql`select pg_database_size(current_database())::bigint as size`;

	return {
		dir: env.cacheDir,
		disk,
		cache: { files, bytes },
		database: { bytes: Number(db?.size ?? 0) }
	};
}

/**
 * Brings files and rows back in line: deletes files without a matching row (and leftover .part files),
 * and forgets cache entries whose file is gone.
 */
export async function reconcileCache() {
	await ensureCacheDir();
	const names = await readdir(env.cacheDir);

	const partials = names.filter(name => name.endsWith(".part"));
	await Promise.all(partials.map(name => unlink(cachePath(name)).catch(() => {})));

	const files = names.filter(isCacheFileName);
	const rows = await sql<{ id: string, cache_file: string }[]>`
		select id::text, cache_file from pool where cache_file is not null
	`;
	const known = new Set(rows.map(row => row.cache_file));
	const present = new Set(files);

	const orphans = files.filter(name => !known.has(name));
	await removeCacheFiles(orphans);

	const missing = rows.filter(row => !present.has(row.cache_file)).map(row => row.id);
	if (missing.length > 0)
		await sql`update pool set cache_file = null, cache_variant = null where id in ${sql(missing)}`;

	return { removedFiles: orphans.length, removedPartials: partials.length, forgottenRows: missing.length };
}

export async function retryFailedCache() {
	const rows = await sql`
		update pool set cache_attempts = 0, cache_error = null
			where cache_file is null and cache_attempts >= ${MAX_CACHE_ATTEMPTS}
			returning id
	`;
	return { reset: rows.length };
}
