import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../..");

function int(raw: string | undefined, fallback: number) {
	const parsed = parseInt(raw ?? "", 10);
	return isNaN(parsed) ? fallback : parsed;
}

function list(raw: string | undefined) {
	return (raw ?? "").split(",").map(s => s.trim()).filter(Boolean);
}

function required(name: string) {
	const value = Bun.env[name];
	if (!value) throw new Error(`${name} is not set (see .env.example)`);
	return value;
}

export const env = {
	port: parseInt(Bun.env.PORT || "7780", 10),
	dbConnection: required("DB_CONNECTION"),
	/** Public origin of the dashboard, used to build /resize URLs handed to Telegram */
	publicUrl: (Bun.env.PUBLIC_URL || "").replace(/\/$/, ""),
	corsOrigins: list(Bun.env.CORS_ORIGIN),
	resizeHosts: list(Bun.env.RESIZE_HOSTS || "gelbooru.com").map(h => h.toLowerCase()),
	outboundProxy: Bun.env.OUTBOUND_PROXY || null,
	tgToken: Bun.env.TG_TOKEN || "",
	tgTargetMe: Bun.env.TG_TARGET_ME || "",

	/** Where cached media lives; relative paths resolve against the repository root */
	cacheDir: resolve(REPO_ROOT, Bun.env.CACHE_DIR || "cache"),
	/** Pause between worker checks */
	cacheIntervalMs: Math.max(int(Bun.env.CACHE_INTERVAL_SEC, 12), 2) * 1000,
	/** Posts downloaded per check, one after another */
	cacheBatch: Math.max(int(Bun.env.CACHE_BATCH, 10), 1),
	/** Files larger than this are skipped (mostly huge animated originals) */
	cacheMaxBytes: Math.max(int(Bun.env.CACHE_MAX_MB, 200), 1) * 1024 * 1024,
	/** Initial worker state when nothing was saved from the dashboard yet */
	cacheWorkerDefault: (Bun.env.CACHE_WORKER || "on").toLowerCase() !== "off",
	/** Key for signed /media URLs. Random per process when unset, which only invalidates open pages on restart. */
	mediaSecret: Bun.env.MEDIA_SECRET || ""
};

if (!env.publicUrl)
	console.warn("PUBLIC_URL is not set: Telegram will not be able to reach the /resize image proxy");
