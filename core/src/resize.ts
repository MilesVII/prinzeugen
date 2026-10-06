export type MediaFormat = {
	isImage: boolean,
	format: string,
	mime: string
};

/** Downscales an image or video to fit w×h via ffmpeg. Videos are re-encoded to h264 mp4. */
export async function resize(bytes: ArrayBuffer, meta: MediaFormat, [w, h] = [1280, 1280]) {
	const videoFlags = [
		"-acodec", "copy",
		"-vcodec", "libx264",
		"-preset", "veryfast",
		"-movflags", "empty_moov"
	];
	const imageFlags: string[] = [];

	const ffmpeg = Bun.spawn(
		[
			"ffmpeg",
			"-i", "pipe:0",
			"-vf", `scale=iw*min(1\\,min(${w}/iw\\,${h}/ih)):-1`,
			...(meta.isImage ? imageFlags : videoFlags),
			"-f", meta.format,
			"pipe:1"
		],
		{
			stdin: new Uint8Array(bytes),
			stdout: "pipe",
			stderr: "inherit"
		}
	);

	const output = await new Response(ffmpeg.stdout as ReadableStream<Uint8Array>).arrayBuffer();
	await ffmpeg.exited;
	return Buffer.from(output);
}

// https://gist.github.com/DusanBrejka/35238dccb5cefcc804de1c5a218ee004
const imageFormats: Record<string, string> = {
	"image/webp": "webp",
	"image/vnd.microsoft.icon": "ico",
	"image/png": "apng",
	"image/jpeg": "mjpeg"
};
const videoFormats: Record<string, string> = {
	"image/gif": "gif",
	"video/3gpp2": "3g2",
	"video/3gpp": "3gp",
	"video/mpeg": "vob",
	"video/x-flv": "live_flv",
	"video/x-h261": "h261",
	"video/x-h263": "h263",
	"video/mp4": "mp4",
	"video/x-m4v": "m4v",
	"video/x-matroska": "matroska",
	"video/webm": "matroska,webm",
	"video/x-mjpeg": "mjpeg_2000",
	"video/MP2T": "mpegtsraw",
	"video/x-nut": "nut",
	"video/ogg": "ogv",
	"application/vnd.rn-realmedia": "rm",
};

export function detectFormat(mime: string | null): MediaFormat | null {
	if (!mime) return null;
	const bare = mime.split(";")[0]!.trim();

	const imageFormat = imageFormats[bare];
	if (imageFormat) {
		return { isImage: true, format: imageFormat, mime: bare };
	}

	if (videoFormats[bare]) {
		return { isImage: false, format: "mp4", mime: "video/mp4" };
	}

	return null;
}
