import { mudcrack } from "rampike";
import { api, ok, el, isVideoUrl } from "./utils/utils";
import { pullCurtain } from "./utils/curtain";
import type { RampikePagination } from "./components/pagination";

export const PLACEHOLDER_URL = "placeholder.png";
const STRIDE = 64;

export function initPool() {
	el<RampikePagination>("#pool-pagination")?.addEventListener("pick", e => {
		loadMessagePool((e as CustomEvent<{ page: number }>).detail.page);
	});
	// stop the preview clip when the dialog closes, and don't keep downloading it
	el<HTMLDialogElement>("dialog#pool-preview")?.addEventListener("close", () => {
		const video = el<HTMLVideoElement>("dialog#pool-preview video");
		if (!video) return;
		video.pause();
		video.removeAttribute("src");
		video.load();
	});
}

function previewUrl(message: any) {
	if (message.version == 1) return message.raw?.preview || message.image?.[0] || PLACEHOLDER_URL;
	if (message.version == 3) return message.cached ? message.cachedContent.preview : message.preview;
	if (message.version == 4) return message.preview;
	return PLACEHOLDER_URL;
}

export async function loadMessagePool(page = 0){
	const container = el("#pool-content");
	const pager = el<RampikePagination>("#pool-pagination");
	if (!container || !pager) return;

	pullCurtain(true, "Loading pool");
	const rows = await api.get<any[]>(`/api/pool?page=${page}&stride=${STRIDE}`);
	pullCurtain(false);
	if (!ok(rows) || !Array.isArray(rows.data)) return;

	container.replaceChildren(...rows.data.map(row => mudcrack({
		tagName: "article",
		className: "lineout pool-item",
		attributes: { "data-id": row.id, "data-failed": `${row.failed}` },
		events: { click: () => setPreviewPost(row) },
		contents: [mudcrack({
			tagName: "img",
			attributes: { loading: "lazy", alt: "", title: generateTitle(row), src: previewUrl(row.message) }
		})]
	})));

	const postCount = rows.data[0]?.total || 0;
	pager.pageCount = Math.ceil(postCount / STRIDE);
	pager.page = page;
}

function setPreviewPost(row: any){
	const dialog = el<HTMLDialogElement>("dialog#pool-preview");
	if (!dialog) return;

	const picture = dialog.querySelector("img");
	const video = dialog.querySelector("video");
	if (!picture || !video) return;

	// the grid keeps gelbooru's tiny previews; the dialog shows the cached copy when there is one
	const showVideo = isVideoUrl(row.cache_url);
	picture.hidden = showVideo;
	video.hidden = !showVideo;
	if (showVideo) {
		picture.removeAttribute("src");
		video.src = row.cache_url;
		video.title = generateTitle(row);
		video.play().catch(() => {});
	} else {
		picture.src = row.cache_url ?? previewUrl(row.message);
		picture.title = generateTitle(row);
	}

	const button = (caption: string, action: () => void) => mudcrack({
		tagName: "button",
		className: "lineout",
		contents: caption,
		events: { click: action }
	});
	const links: { text: string, url: string }[] = row.message?.links ?? [];
	const tags = ["absurdres", "animated"].filter(tag => row.message?.tags?.includes(tag));

	dialog.querySelector("#pool-preview-controls")?.replaceChildren(
		...links.map(link => mudcrack({
			tagName: "a",
			className: "lineout",
			contents: link.text,
			attributes: { href: link.url, target: "_blank", rel: "noreferrer" }
		})),
		...tags.map(tag => mudcrack({ tagName: "span", className: "tag tag-media", contents: tag })),
		button("unschedule", () => unschedulePost(row.id).then(() => dialog.close())),
		row.failed ? button("unfail", () => unfailPost(row.id).then(() => dialog.close())) : "",
		button("log details", () => console.log(row))
	);

	dialog.showModal();
}

async function unschedulePost(rowId: number){
	pullCurtain(true);
	const response = await api.del(`/api/pool/${rowId}`);
	pullCurtain(false);

	if (ok(response)){
		const target = el(`.pool-item[data-id="${rowId}"]`);
		if (target) target.hidden = true;
	}
}

async function unfailPost(rowId: number) {
	pullCurtain(true);
	const response = await api.post(`/api/pool/${rowId}/unfail`);
	pullCurtain(false);

	if (ok(response)){
		const target = el(`.pool-item[data-id="${rowId}"]`);
		if (target) target.dataset.failed = "false";
	}
}

function generateTitle(row: any){
	return [
		row.message.artists?.join(" "),
		row.message.tags?.join(" "),
	].filter(Boolean).join("\n");
}
