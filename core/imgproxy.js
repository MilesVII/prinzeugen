import { safe, phetchV2, processImage, wegood, tgReport } from "./utils.js";

export default async function handler(request, response) {
	response.set('Access-Control-Allow-Credentials', true);
	response.set('Access-Control-Allow-Origin', '*');
	response.set('Access-Control-Allow-Methods', "GET, POST");
	response.set(
		'Access-Control-Allow-Headers',
		'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
	);
	if (request.method === 'OPTIONS') {
		response.status(200).end();
		return;
	}

	const spi = s => safe(() => parseInt(s, 10));
	const url = request.body?.url || request.query.url;
	const w = request.body?.w || spi(request.query.w) || 2048;
	const h = request.body?.h || spi(request.query.h) || 2048;
	const q = request.body?.q || spi(request.query.q) || 80;
	const b = !!(request.body.bypass || request.query.bypass);
	const j = !!(request.query.jpeg || request.query.j);
	const r = request.query.w === "0";

	const original = await phetchV2(url)
	if (!wegood(original.status)) {
		console.log(original.status)
		response.status(503).end();
		return;
	}

	if (b) {
		response.set(original.headers);
		response.status(200).send(original.raw);
		return;
	}

	const options = {
		resize: {
			w: w,
			h: h
		},
		format: j ? "jpeg" : "webp",
		quality: q
	};

	if (r) options.resize = null;

	try {
		const processed = await processImage(original.raw, options)
		response.set("Content-Type", processed.mime);
		response.status(200).end(processed.data);
	} catch(e){
		response.status(204).end(original.raw);
	}
	return;
}