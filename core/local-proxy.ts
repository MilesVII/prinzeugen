const GELBOORU_ORIGIN = "https://gelbooru.com";
const GELBOORU_REFERER = `${GELBOORU_ORIGIN}/`;
const USER_AGENT = "pe-local-proxy/1.0";
const PAGE_TIMEOUT_MS = 10_000;
const IMAGE_TIMEOUT_MS = 20_000;

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Expose-Headers": "Content-Type, Cache-Control",
	"Access-Control-Max-Age": "86400",
};

function corsHeaders(): Headers {
	return new Headers(CORS_HEADERS);
}

class ProxyError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "ProxyError";
	}
}

function json(status: number, message: string): Response {
	return Response.json({ error: message }, {
		status,
		headers: corsHeaders(),
	});
}

function parsePostId(url: URL): string {
	const id = url.searchParams.get("id")?.trim();

	if (!id || !/^\d+$/.test(id) || Number(id) > Number.MAX_SAFE_INTEGER) {
		throw new ProxyError(400, "The id query parameter must be a positive integer.");
	}

	return id;
}

async function extractImageSource(html: string, pageUrl: URL): Promise<string> {
	let imageSource: string | undefined;

	await new HTMLRewriter()
		.on("picture > img", {
			element(element) {
				imageSource ??= element.getAttribute("src")?.trim() || undefined;
			},
		})
		.transform(new Response(html, {
			headers: { "Content-Type": "text/html; charset=utf-8" },
		}))
		.text();

	if (!imageSource) {
		Bun.write("./errors/" + pageUrl.toString().split("=").at(-1) + ".html", html);
		throw new ProxyError(502, "Gelbooru did not return a picture > img element.");
	}

	return new URL(imageSource, pageUrl).href;
}

async function fetchGelbooruImage(postId: string): Promise<Response> {
	const pageUrl = new URL("/index.php", GELBOORU_ORIGIN);
	pageUrl.searchParams.set("page", "post");
	pageUrl.searchParams.set("s", "view");
	pageUrl.searchParams.set("id", postId);

	let pageResponse: Response;
	try {
		pageResponse = await fetch(pageUrl, {
			headers: {
				Accept: "text/html,application/xhtml+xml",
				Referer: GELBOORU_REFERER,
				"User-Agent": USER_AGENT,
			},
			redirect: "follow",
			signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
		});
	} catch (error) {
		if (error instanceof Error && error.name === "TimeoutError") {
			throw new ProxyError(504, "Timed out while fetching the Gelbooru post page.");
		}

		throw new ProxyError(502, "Could not fetch the Gelbooru post page.");
	}

	if (!pageResponse.ok) {
		throw new ProxyError(
			502,
			`Gelbooru returned ${pageResponse.status} while fetching the post page.`,
		);
	}

	const html = await pageResponse.text();
	const imageUrl = await extractImageSource(html, pageUrl);

	let imageResponse: Response;
	try {
		imageResponse = await fetch(imageUrl, {
			headers: {
				Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
				Referer: GELBOORU_REFERER,
				"User-Agent": USER_AGENT,
			},
			redirect: "manual",
			signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
		});
	} catch (error) {
		if (error instanceof Error && error.name === "TimeoutError") {
			throw new ProxyError(504, "Timed out while fetching the Gelbooru image.");
		}

		throw new ProxyError(502, "Could not fetch the Gelbooru image.");
	}

	if (imageResponse.status >= 300 && imageResponse.status < 400) {
		throw new ProxyError(
			502,
			"Gelbooru redirected the image request; the required Referer may be missing.",
		);
	}

	if (!imageResponse.ok) {
		throw new ProxyError(
			502,
			`Gelbooru returned ${imageResponse.status} while fetching the image.`,
		);
	}

	const contentType = imageResponse.headers.get("Content-Type") ?? "application/octet-stream";
	const headers = corsHeaders();
	headers.set("Content-Type", contentType);
	headers.set("Cache-Control", "no-store");

	return new Response(imageResponse.body, {
		status: imageResponse.status,
		headers,
	});
}

const PORT = 80;

const server = Bun.serve({
	port: PORT,
	hostname: "localhost",
	async fetch(request) {
		const url = new URL(request.url);

		if (url.pathname !== "/proxy") {
			return json(404, "Not found.");
		}

		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders(),
			});
		}

		if (request.method !== "GET") {
			return json(405, "Only GET requests are supported.");
		}

		try {
			const postId = parsePostId(url);
			return await fetchGelbooruImage(postId);
		} catch (error) {
			if (error instanceof ProxyError) {
				return json(error.status, error.message);
			}

			console.error(error);
			return json(500, "The proxy encountered an unexpected error.");
		}
	},
});

console.log(`Proxy listening at http://${server.hostname}:${server.port}/proxy?id=<post-id>`);
