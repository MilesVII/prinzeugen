import handler from "./main";

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
			const ffmpegFormat = ffmpegFormatMap[mime];
			if (!ffmpegFormat) return Response(null, { status:415, headers: cors });

			const resized = await resize(bytes, ffmpegFormat);

			return new Response(
				resized,
				{
					status: 200,
					headers: {
						...cors,
						"Content-Type": mime
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

async function resize(bytes, format) {
	const ffmpeg = Bun.spawn(
		[
			"ffmpeg",
			"-i", "pipe:0",
			"-vf", "scale=w=2048:h=2048:force_original_aspect_ratio=decrease",
			"-f", format,
			"pipe:1"
		],
		{
			stdin: bytes,
			stdout: "pipe",
			stderr: "inherit"
		}
	);

	const chunks = [];
	for await (const chonk of ffmpeg.stdout) {
		chunks.push(chonk);
	}

	ffmpeg.kill();
	return Buffer.concat(chunks);
}

// https://gist.github.com/DusanBrejka/35238dccb5cefcc804de1c5a218ee004
const ffmpegFormatMap = {
	"application/vnd.pg.format": "3dostr",
	"video/3gpp2": "3g2",
	"video/3gpp": "3gp",
	"audio/x-adpcm": "4xm",
	"application/octet-stream ": "a64",
	"application/octet-stream": "bin",
	"audio/aac": "adts",
	"audio/x-ac3": "ac3",
	"audio/aiff": "aiff",
	"audio/amr": "amr",
	"image/png": "apng",
	"video/x-ms-asf": "asf_stream",
	"text/x-ass": "ass",
	"audio/basic": "au",
	"video/x-msvideo": "avi",
	"application/x-shockwave-flash": "swf",
	"audio/bit": "bit",
	"audio/x-caf": "caf",
	"audio/x-dca": "dts",
	"video/mpeg": "vob",
	"audio/x-eac3": "eac3",
	"application/f4v": "f4v",
	"audio/x-flac": "flac",
	"video/x-flv": "live_flv",
	"audio/G722": "g722",
	"audio/g723": "g723_1",
	"image/gif": "gif",
	"audio/x-gsm": "gsm",
	"video/x-h261": "h261",
	"video/x-h263": "h263",
	"application/x-mpegURL": "hls,applehttp",
	"image/vnd.microsoft.icon": "ico",
	"audio/iLBC": "ilbc",
	"video/mp4": "mp4",
	"text/x-jacosub": "jacosub",
	"image/jpeg": "mjpeg",
	"audio/MP4A-LATM": "latm",
	"video/x-m4v": "m4v",
	"video/x-matroska": "matroska",
	"video/webm": "matroska,webm",
	"text/x-microdvd": "microdvd",
	"video/x-mjpeg": "mjpeg_2000",
	"application/vnd.smaf": "mmf",
	"audio/mpeg": "mp3",
	"video/MP2T": "mpegtsraw",
	"multipart/x-mixed-replace;boundary=ffserver": "mpjpeg",
	"application/mxf": "mxf_opatom",
	"video/x-nut": "nut",
	"audio/ogg": "spx",
	"application/ogg": "ogg",
	"video/ogg": "ogv",
	"audio/x-oma": "oma",
	"application/vnd.rn-realmedia": "rm",
	"application/x-subrip": "srt",
	"application/x-pgs": "sup",
	"audio/x-tta": "tta",
	"audio/x-voc": "voc",
	"audio/x-wav": "wav",
	"application/xml": "webm_dash_manifest",
	"image/webp": "webp",
	"text/vtt": "webvtt",
	"audio/x-wavpack": "wv"
};
