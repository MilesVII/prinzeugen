import { mudcrack } from "rampike";
import { api, ok, el, isVideoUrl, createPreviewVideo } from "./utils/utils";
import { pullCurtain } from "./utils/curtain";
import { isBusy as upscalerIsBusy, loadTasks, runTasks, flushTasks } from "./utils/upscaler";
import { PLACEHOLDER_URL } from "./pool";

export async function downloadModerables(){
	const messages = await api.get<any[]>("/api/moderables");
	return ok(messages) ? messages.data : null;
}

export async function reloadModerables(){
	pullCurtain(true);
	const messages = await downloadModerables();
	pullCurtain(false);
	if (messages) displayModerables(messages);
}

export function displayModerables(messages: any[]){
	const list = el("#moderables-list");
	if (!list) return;
	list.replaceChildren(...messages.flatMap(m => renderModerable(m.message, m.id, m.cache_url ?? null) ?? []));
}

function renderTag(text: string, accent = false){
	return mudcrack({ tagName: "span", className: accent ? "lineout tag-nsfw" : "lineout", contents: text });
}

function renderModerable(message: any, id: string, cacheUrl: string | null){
	if (message.version != 3 && message.version != 4){
		console.error("Unsupported message version");
		return;
	}

	const source: string = message.links[0].url;
	const tags: string[] = message.tags ?? [];

	// Cached videos get a real player instead of the <a><img> preview. It plays while the card
	// has focus, so stepping through with the keyboard previews each clip in turn.
	const video = cacheUrl && isVideoUrl(cacheUrl) ? createPreviewVideo(cacheUrl) : null;
	const playIfFocused = () => {
		if (video && card.contains(document.activeElement)) video.play().catch(() => {});
	};
	// focus can arrive before the clip has loaded
	video?.addEventListener("canplay", playIfFocused, { once: true });

	const media = video ?? mudcrack({
		tagName: "a",
		attributes: { href: source, target: "_blank", rel: "noreferrer", tabindex: -1 },
		contents: [mudcrack({ tagName: "img", attributes: { loading: "lazy", alt: "", src: cacheUrl ?? PLACEHOLDER_URL } })]
	});

	const decision = (caption: string, approved: boolean) => mudcrack({
		tagName: "button",
		className: "lineout",
		contents: caption,
		attributes: { tabindex: -1, "data-moderable-button": approved ? "approve" : "reject" },
		events: {
			click: event => {
				event.stopPropagation();
				card.classList.toggle("approved", approved);
				card.classList.toggle("rejected", !approved);
			}
		}
	});

	const card: HTMLDivElement = mudcrack({
		className: "moderable lineout list",
		attributes: {
			tabindex: 0,
			"data-id": id,
			"data-original": message.content,
			"data-ref": message.reference,
			// served from the server's media cache; the upscaler skips anything marked upscaled
			"data-upscaled": cacheUrl ? "cache" : message.cached ? "weewee" : null,
			"data-cached": cacheUrl ? "true" : null
		},
		events: {
			click: () => card.focus(),
			focusin: () => {
				card.scrollIntoView({ block: "center" });
				playIfFocused();
			},
			focusout: () => video?.pause(),
			// keeps focus on the card (not the player) so the , and . shortcuts keep working
			mousedown: event => event.preventDefault()
		},
		contents: [
			media,
			mudcrack({
				className: "row-wrap moderable-info",
				contents: [
					...(message.artists ?? []).map((artist: string) => renderTag(`🎨 ${artist}`)),
					message.nsfw && renderTag("nsfw", true),
					tags.includes("animated") && renderTag("animated"),
					tags.includes("animated_gif") && renderTag("gif"),
					tags.includes("video") && renderTag("video"),
					// the player replaced the link, keep a way to open the post
					video && mudcrack({
						tagName: "a",
						className: "lineout",
						contents: "open ↗",
						attributes: { href: source, target: "_blank", rel: "noreferrer", tabindex: -1 },
						events: { click: event => event.stopPropagation() }
					})
				]
			}),
			mudcrack({
				className: "row-wrap moderable-actions",
				contents: [decision("approve", true), decision("reject", false)]
			})
		]
	});

	return card;
}

export async function upscalePreviews(){
	if (upscalerIsBusy()) return;

	const moderables = Array.from(document.querySelectorAll<HTMLElement>(".moderable"));
	const abortButton = el("#moderables-upscale-abort");
	const upscaleButton = el("#moderables-upscale");

	loadTasks(moderables);
	runTasks(() => {
		if (upscaleButton) upscaleButton.hidden = false;
		if (abortButton) abortButton.hidden = true;
	});

	if (upscaleButton) upscaleButton.hidden = true;
	if (abortButton) abortButton.hidden = false;
}

export function fixFocus(){
	const target = el(".moderable:not(.approved):not(.rejected)");
	if (target)
		target.focus();
	else
		el(".moderable")?.focus();
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
		el("#moderables-submit")?.scrollIntoView({behavior: "smooth", block: "center"});
}

export function moveFocus(next: boolean) {
	const focused = document.activeElement;

	if (!focused) {
		el(".moderable")?.focus();
		return;
	}

	const options = Array.from(document.querySelectorAll<HTMLElement>(".moderable"));
	const currentIndex = options.findIndex(option => option === focused);

	if (currentIndex === -1) {
		options[0]?.focus();
		return;
	}
	if (options.length === 1) return;

	let targetIndex = currentIndex + (next ? 1 : -1);
	if (targetIndex < 0) targetIndex = options.length - 1;
	if (targetIndex >= options.length) targetIndex = 0;

	options[targetIndex]?.focus();
}

export async function moderate(){
	flushTasks();

	const decisionsCards = document.querySelectorAll<HTMLElement>(".moderable.approved, .moderable.rejected");
	const decisions = Array.from(decisionsCards).map(d => ({
		id: parseInt(d.dataset.id ?? "", 10),
		approved: d.classList.contains("approved")
	}));
	if (decisions.length == 0) return;

	pullCurtain(true);
	const newModerables = await api.post<any[]>("/api/moderate", { decisions });
	pullCurtain(false);

	if (ok(newModerables)) displayModerables(newModerables.data);
}
