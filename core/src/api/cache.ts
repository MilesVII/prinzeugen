import { Elysia } from "elysia";
import { cacheWorkerStatus, startCacheWorker, stopCacheWorker } from "../services/cacheWorker.ts";
import { cacheCounts, storageStats, reconcileCache, retryFailedCache } from "../services/media.ts";
import { authorized } from "./authorized.ts";

async function overview() {
	const [counts, storage] = await Promise.all([cacheCounts(), storageStats()]);
	return { worker: cacheWorkerStatus(), counts, storage };
}

export const cacheRoutes = new Elysia()
	.use(authorized)

	.get("/cache", () => overview(), { auth: "admin" })

	.post("/cache/start", async () => {
		await startCacheWorker();
		return overview();
	}, { auth: "admin" })

	.post("/cache/stop", async () => {
		await stopCacheWorker();
		return overview();
	}, { auth: "admin" })

	.post("/cache/retry", () => retryFailedCache(), { auth: "admin" })

	.post("/cache/reconcile", () => reconcileCache(), { auth: "admin" });
