import { callAPI, fromTemplate } from "./utils/utils";
import { pullCurtain } from "./utils/curtain";

const PLACEHOLDER_URL = "placeholder.png";
export async function loadMessagePool(page = 0){
	const STRIDE = 64;
	const container = document.querySelector("#pool-content");
	if (!container) return;

	const pager = document.querySelector("#pool-pagination");
	if (!pager) return;

	container.innerHTML = "";

	pullCurtain(true);
	const rows = await callAPI("getPoolPage", {
		page: page,
		stride: STRIDE
	}, true);
	pullCurtain(false);

	for (let row of rows.data){
		const proto = (fromTemplate("generic-pool-item") as Element)?.firstElementChild as HTMLElement;
		if (!proto) return;

		proto.dataset.id = row.id;
		proto.dataset.failed = row.failed;
		const img = proto.querySelector("img");
		if (!img) return;

		img.title = generateTitle(row);

		if (row.message.version == 1){
			img.src = row.message.raw?.preview || row.message.image[0];
		} else if (row.message.version == 3) {
			img.src = row.message.cached ? row.message.cachedContent.preview : row.message.preview;
		} else if (row.message.version == 4) {
			img.src = row.message.preview;
		} else {
			img.src = PLACEHOLDER_URL;
		}
		proto.addEventListener("click", () => setPreviewPost(row));

		container.append(proto);
	}

	pager.innerHTML = "";
	const postCount = rows.data[0]?.total || 0;
	const pageCount = Math.ceil(postCount / STRIDE);
	for (let i = 0; i < pageCount; ++i){
		const pageSelector = document.createElement("button");
		pageSelector.textContent = `${i + 1}`;
		pageSelector.addEventListener("click", () => loadMessagePool(i));
		pager.appendChild(pageSelector);
	}
}

function setPreviewPost(row: any){
	const dialog = document.querySelector<HTMLDialogElement>("dialog#pool-preview");
	if (!dialog) return;

	const picture = dialog.querySelector("img");
	if (!picture) return;

	if (row.message.version == 3 || row.message.version == 4){
		picture.src = row.message.cached ? row.message.cachedContent.preview : row.message.preview;
	} else {
		picture.src = row ? row.message.raw.preview || row.message.image[0] : PLACEHOLDER_URL;
	}

	picture.title = generateTitle(row);

	const controls = dialog.querySelector("#pool-preview-controls");
	if (!controls) return;
	controls.innerHTML = "";

	function button(caption: string, action: () => void) {
		const b = document.createElement("button");
		b.textContent = caption;
		b.addEventListener("click", action);
		return b;
	}
	
	const linkset: {text: string, url: string}[] = (row.message?.links || []);
	const links = linkset.map(link => {
		const anchor = document.createElement("a");
		anchor.textContent = link.text;
		anchor.href = link.url;
		anchor.classList.add("clickable");
		anchor.target = "_blank";
		return anchor;
	});

	const tags = ["absurdres", "animated"]
		.filter(item => row.message?.tags?.includes(item))
		.map(tag => {
			const tagProto = (fromTemplate("generic-pool-item-tag") as Element)?.firstElementChild as HTMLElement;
			if (!tagProto) return null;
			tagProto.textContent = tag;
			return tagProto;
		})
		.filter(tag => tag) as ChildNode[];

	controls.append(
		...links,
		...tags,
		button("Unschedule", () => unschedulePost(row.id).then(() => dialog.close())),
		...[button("Unfail", () => unfailPost(row.id).then(() => dialog.close()))]
			.filter(() => row.failed),
		button("Show item details in console", () => console.log(row))
	);

	dialog.showModal();
}

async function unschedulePost(rowId: number){
	pullCurtain(true);
	const response = await callAPI("unschedulePost", {
		id: rowId
	}, true);
	pullCurtain(false);

	if (response.status < 300){
		const target = document.querySelector(`.pool-item[data-id="${rowId}"]`);
		if (target) target.classList.add("hidden");
	}
}

async function  unfailPost(rowId: number) {
	pullCurtain(true);
	const response = await callAPI("unfailPost", {
		id: rowId
	}, true);
	pullCurtain(false);

	if (response.status < 300){
		const target = document.querySelector<HTMLElement>(`.pool-item[data-id="${rowId}"]`);
		if (target) target.dataset.failed = "false";
	}
}

function generateTitle(row: any){
	return [
		row.message.artists?.join(" "),
		row.message.tags?.join(" "),
	].join("\n");
}
