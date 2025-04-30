import handler from "./main";
import { resize, detectFormat } from "./resize";

const index = Bun.file("../frontend/dist/index.html");
const cors = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
	"Access-Control-Allow-Credentials": true,
}

const server = Bun.serve({
	port: 7780,
	development: {
		hmr: false
	},
	fetch: async (request) => {
		const url = new URL(request.url);
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 200,
				headers: cors
			});
		}

		if (url.pathname.startsWith("/api")) {
			const params = await request.json();
			const [status, payload] = await handler(params);
			const options = { status, headers: cors }
			if (payload) {
				switch (typeof payload) {
					case ("string"): {
						return new Response(payload, options)
					}
					default: {
						return Response.json(payload, options)
					}
				}
			}

			return new Response(null, options);
		}
		if (url.pathname.startsWith("/resize")) {
			const source = url.searchParams.get("source");
			if (!source) return new Response(null, { status: 400, headers: cors });

			const response = await fetch(decodeURIComponent(source));
			if (!response.ok) return new Response(null, { status: 502, headers: cors });

			const bytes = await response.arrayBuffer();
			const mime = response.headers.get("Content-Type");
			const format = detectFormat(mime);
			if (!format) return Response(null, { status:415, headers: cors });

			const resized = await resize(bytes, format);

			return new Response(
				resized,
				{
					status: 200,
					headers: {
						...cors,
						"Content-Type": format.mime
					}
				}
			);
		}

		const file = Bun.file(`../frontend/dist${url.pathname}`);
		if (await file.exists()) {
			return new Response(file);
		}

		return new Response(index);
	}
});

console.log(`Listening on ${server.url}`);