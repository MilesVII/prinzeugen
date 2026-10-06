import { api, ok, fromTemplateFirst, el } from "./utils/utils";
import { pullCurtain } from "./utils/curtain";
import type { RampikePagination } from "./components/pagination";

const PLACEHOLDER_URL = "placeholder.png";
const STRIDE = 64;

export function initPool() {
	el<RampikePagination>("#pool-pagination")?.addEventListener("pick", e => {
		loadMessagePool((e as CustomEvent<{ page: number }>).detail.page);
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

	container.innerHTML = "";
	for (const row of rows.data){
		const proto = fromTemplateFirst("generic-pool-item");
		if (!proto) return;

		proto.dataset.id = row.id;
		proto.dataset.failed = `${row.failed}`;
		const img = proto.querySelector("img");
		if (!img) return;

		img.title = generateTitle(row);
		img.loading = "lazy";
		img.src = previewUrl(row.message);
		proto.addEventListener("click", () => setPreviewPost(row));

		container.append(proto);
	}

	const postCount = rows.data[0]?.total || 0;
	pager.pageCount = Math.ceil(postCount / STRIDE);
	pager.page = page;
}

function setPreviewPost(row: any){
	const dialog = el<HTMLDialogElement>("dialog#pool-preview");
	if (!dialog) return;

	const picture = dialog.querySelector("img");
	if (!picture) return;

	picture.src = previewUrl(row.message);
	picture.title = generateTitle(row);

	const controls = dialog.querySelector("#pool-preview-controls");
	if (!controls) return;
	controls.innerHTML = "";

	function button(caption: string, action: () => void) {
		const b = document.createElement("button");
		b.className = "lineout";
		b.textContent = caption;
		b.addEventListener("click", action);
		return b;
	}

	const linkset: {text: string, url: string}[] = (row.message?.links || []);
	const links = linkset.map(link => {
		const anchor = document.createElement("a");
		anchor.textContent = link.text;
		anchor.href = link.url;
		anchor.className = "lineout";
		anchor.target = "_blank";
		anchor.rel = "noreferrer";
		return anchor;
	});

	const tags = ["absurdres", "animated"]
		.filter(item => row.message?.tags?.includes(item))
		.map(tag => {
			const pill = document.createElement("span");
			pill.className = "tag tag-media";
			pill.textContent = tag;
			return pill;
		});

	const failed = row.failed ? [button("unfail", () => unfailPost(row.id).then(() => dialog.close()))] : [];

	controls.append(
		...links,
		...tags,
		button("unschedule", () => unschedulePost(row.id).then(() => dialog.close())),
		...failed,
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
