import { callAPI, fromTemplate, sleep, chunk } from "./utils/utils";
import { pullCurtain } from "./utils/curtain";

export async function downloadModerables(){
	const messages = await callAPI("getModerables", null, true);
	if (messages.status == 200)
		return messages.data;
	else
		return null;
}

export async function reloadModerables(){
	pullCurtain(true);
	const messages = await downloadModerables();
	pullCurtain(false);
	if (messages) displayModerables(messages);
}

export function displayModerables(messages: any[]){
	const list = document.querySelector("#moderables-list");
	if (!list) return;
	list.innerHTML = "";
	messages.forEach(m => {
		const item = renderModerable(m.message, m.id);
		if (item) list.append(item);
	});
}

function renderModerable(message: any, id: string){
	if (message.version != 3){
		console.error("Unsupported message version");
		return;
	}

	const proto = (fromTemplate("generic-moderable") as Element)?.firstElementChild as HTMLElement;
	if (!proto) return;

	proto.dataset.id = id;
	proto.dataset.original = message.content;
	if (message.cached) proto.dataset.upscaled = "weewee";

	proto.addEventListener("click", () => proto.focus());

	const preview = message.cached ? message.cachedContent.preview : message.preview;
	const source = message.links[0].url;

	const link = proto.querySelector("a");
	if (link) link.href = source;
	const image = proto.querySelector("img");
	if (image) image.src = preview;

	function renderTag(text: string, color: string){
		const e = document.createElement("div");
		e.className = "rounded bordered padded";
		e.textContent = text;
		e.style.backgroundColor = color;
		return e;
	}
	const tags = proto.querySelector(".moderable-info");
	if (tags){
		if (message.artists)
			message.artists.forEach((artist: string) =>
				tags.append(renderTag(`🎨 ${artist}`, "transparent"))
			);
		if (message.nsfw)
			tags.append(renderTag("NSFW", "rgba(200, 0, 0, .3"));
		if (message.tags?.includes("animated"))
			tags.append(renderTag("animated", "rgba(50, 50, 200, .3"));
		if (message.tags?.includes("animated_gif"))
			tags.append(renderTag("GIF", "rgba(50, 50, 200, .3"));
		if (message.tags?.includes("video"))
			tags.append(renderTag("video", "rgba(50, 50, 200, .3"));
	}

	proto.querySelectorAll<HTMLElement>("[data-moderable-button]").forEach(b => {
		if (b.dataset.moderableButton === "approve"){
			b.addEventListener("click", e => {
				e.stopPropagation();
				proto.classList.remove("rejected");
				proto.classList.add("approved");
			});
		} else {
			b.addEventListener("click", e => {
				e.stopPropagation();
				proto.classList.add("rejected");
				proto.classList.remove("approved");
			});
		}
	});

	proto.addEventListener("focusin", () => proto.scrollIntoView({/*behavior: "smooth", */block: "center"}));
	proto.addEventListener("mousedown", e => e.preventDefault());

	return proto;
}

const UPSCALE_RETRY_COUNT = 3;
export async function upscalePreviews(){
	async function upscale(e: HTMLElement, retriesLeft = UPSCALE_RETRY_COUNT){
		if (e.dataset.upscaled && retriesLeft === UPSCALE_RETRY_COUNT) return;
		e.dataset.upscaled = "weewee";

		const url = `/imageproxy?bypass=1&url=${e.dataset.original}`;
		const response = await fetch(url);
		if (response.status === 504) {
			if (retriesLeft <= 0) return;
			await sleep(Math.random() * 5000);
			await upscale(e, retriesLeft - 1);
			return;
		}
		if (!response.ok) return;
		if (!response.headers.get("content-type")?.startsWith("image/")) return;

		const data = await response.arrayBuffer();
		const blob = new Blob([data]);

		const image = e.querySelector("img");
		if (image) image.src = URL.createObjectURL(blob);
	}

	const moderables = Array.from(document.querySelectorAll<HTMLElement>(".moderable"));
	const chomnks = chunk(moderables, 7);
	for (const chonk of chomnks) {
		const scaleJobs = chonk.map(e => upscale(e));
		await Promise.allSettled(scaleJobs);
	};
}

export function fixFocus(){
	const target = document.querySelector<HTMLElement>(".moderable:not(.approved):not(.rejected)");
	if (target)
		target.focus();
	else
		document.querySelector<HTMLElement>(".moderable")?.focus();
}

export function decide(approve: boolean){
	const focused = document.activeElement;
	if (!focused?.classList.contains("moderable")) return;

	const buttonQuery = `button[data-moderable-button="${approve ? "approve" : "reject"}"]`;
	focused.querySelector<HTMLButtonElement>(buttonQuery)?.click();

	const nextSib = focused.nextElementSibling as HTMLElement;
	if (nextSib?.classList.contains("moderable"))
		nextSib.focus();
	else
		document.querySelector("#moderables-submit")?.scrollIntoView({behavior: "smooth", block: "center"});
}

export async function moderate(){
	const decisionsCards = document.querySelectorAll<HTMLElement>(".moderable.approved, .moderable.rejected");
	const decisions = Array.from(decisionsCards).map(d => ({
		id: parseInt(d.dataset.id ?? "", 10),
		approved: d.classList.contains("approved")
	}));
	if (decisions.length == 0) return;

	pullCurtain(true);
	const newModerables = await callAPI("moderate", {decisions: decisions}, true);
	
	pullCurtain(false);
	displayModerables(newModerables.data);
}
