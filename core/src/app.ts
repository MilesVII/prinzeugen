import { Elysia, t } from "elysia";
import { join, resolve, sep } from "node:path";
import { env } from "./env.ts";
import { api } from "./api/index.ts";
import { resize, detectFormat } from "./resize.ts";
import { felch, hostAllowed } from "./utils.ts";

const STATIC_ROOT = resolve(import.meta.dir, "../../frontend/dist");
export const INDEX = Bun.file(join(STATIC_ROOT, "index.html"));
const PROXIE_HOSTS = ["gelbooru.com"];
const GELBOORU_REFERER = "https://gelbooru.com/";

function corsHeaders(origin: string | null): Record<string, string> {
	if (!origin || !env.corsOrigins.includes(origin)) return {};
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Vary": "Origin"
	};
}

function staticFile(pathname: string) {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	const path = resolve(STATIC_ROOT, `.${decoded}`);
	if (path !== STATIC_ROOT && !path.startsWith(STATIC_ROOT + sep)) return null;
	return Bun.file(path);
}

export const app = new Elysia()
	.onError(({ code, error, set }) => {
		if (code === "VALIDATION" || code === "NOT_FOUND" || code === "PARSE") return;
		console.error(error);
		set.status = 500;
		return "Internal error";
	})
	.onRequest(({ request, set }) => {
		Object.assign(set.headers, corsHeaders(request.headers.get("origin")));
	})
	.options("/*", ({ set }) => {
		set.status = 204;
		return "";
	})

	.use(api)

	// Thin passthrough for browser-side gelbooru API calls: /proxie/gelbooru.com/index.php?...
	.get("/proxie/*", async ({ params, request, status }) => {
		const rest = params["*"];
		const host = rest.split("/")[0] ?? "";
		if (!host || !hostAllowed(host, PROXIE_HOSTS)) return status(403, "Host not allowed");

		const upstream = await fetch(`https://${rest}${new URL(request.url).search}`, {
			headers: { "Referer": GELBOORU_REFERER },
			signal: AbortSignal.timeout(15_000)
		});
		return new Response(upstream.body, {
			status: upstream.status,
			headers: {
				"Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
				"Cache-Control": "no-store"
			}
		});
	})

	// Public image/video downscaler used as a fallback source for Telegram uploads
	.get("/resize", async ({ query, status }) => {
		let target: URL;
		try {
			target = new URL(query.source);
		} catch {
			return status(400, "source must be a URL");
		}
		if (target.protocol !== "https:" || !hostAllowed(target.hostname, env.resizeHosts))
			return status(403, "Host not allowed");

		const response = await felch(target.href, {
			headers: { "Referer": GELBOORU_REFERER }
		});
		if (!response.ok) return status(502, "Upstream failed");

		const format = detectFormat(response.headers.get("Content-Type"));
		if (!format) return status(415, "Unsupported media type");

		const resized = await resize(await response.arrayBuffer(), format);
		return new Response(resized, {
			headers: { "Content-Type": format.mime }
		});
	}, {
		query: t.Object({ source: t.String() })
	})

	// Static frontend with SPA fallback
	.get("/*", async ({ path }) => {
		const file = staticFile(path);
		if (file && await file.exists() && (await file.stat()).isFile()) return file;
		return INDEX;
	});

export type App = typeof app;
