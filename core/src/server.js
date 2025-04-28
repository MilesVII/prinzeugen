import handler from "./main";

const index = Bun.file("../frontend/dist/index.html");

const server = Bun.serve({
	port: 7780,
	development: {
		hmr: false
	},
	fetch: async (request) => {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/api")) {
			const cors = {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "POST, OPTIONS",
				"Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
				"Access-Control-Allow-Credentials": true,
			}
			const response = new Response(null, {
				headers: cors,
				status: 200
			});

			if (request.method === "OPTIONS") {
				return response;
			}

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
		} else {
			const file = Bun.file(`../frontend/dist${url.pathname}`);
			if (await file.exists()) {
			  return new Response(file);
			}

			return new Response(index);
		}
	}
});

console.log(`Listening on ${server.url}`);
