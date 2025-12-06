
export async function resize(bytes, meta, [w, h] = [1280, 1280]) {
	const videoFlags = [
		"-acodec", "copy",
		"-vcodec", "libx264",
		"-preset", "veryfast",
		"-movflags", "empty_moov"
	];
	const imageFlags = [];

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
const imageFormats = {
	"image/webp": "webp",
	"image/vnd.microsoft.icon": "ico",
	"image/png": "apng",
	"image/jpeg": "mjpeg"
};
const videoFormats = {
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
export function detectFormat(mime) {
	const imageFormat = imageFormats[mime];
	if (imageFormat) {
		return {
			isImage: true,
			format: imageFormat,
			mime
		};
	}

	const videoFormat = videoFormats[mime];
	if (videoFormat) {
		return {
			isImage: false,
			format: "mp4",
			mime: "video/mp4"
		};
	}

	return null;
}
