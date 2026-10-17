import { mudcrack } from "rampike";
import { api, ok, errorText, el } from "./utils/utils";
import { Grabbers } from "./utils/grabbers";
import type { Grabber, GrabberType } from "./utils/grabbers";
import { pullCurtain, updateCurtainMessage } from "./utils/curtain";
import { report } from "./utils/console";
import { downloadModerables, displayModerables } from "./moderation";

import * as forms from "./utils/forms";

export async function downloadGrabbers(): Promise<any[] | null> {
	const grabbers = await api.get<any[]>("/api/grabbers");
	return ok(grabbers) ? grabbers.data : null;
}

export function displayGrabbers(grabs: any[]){
	const list = el("#grabbers-list");
	if (!list) return;
	list.replaceChildren(...grabs.flatMap((g, i) => {
		const meta: Grabber | undefined = Grabbers[g.type as GrabberType];
		const card = meta && renderGrabber(g.type, i);
		if (!meta || !card) return [];
		meta.fill(card, g);
		return [card];
	}));
}

export async function batchGrab(){
	pullCurtain(true);
	const grabbersReference = await downloadGrabbers();
	if (!grabbersReference) {
		pullCurtain(false);
		return;
	}
	let newRowsCount = 0;
	for (let i = 0; i < grabbersReference.length; ++i){
		updateCurtainMessage(`Grabbing: ${i} / ${grabbersReference.length} done`);
		const response = await api.post<{ added: number }>("/api/grab", { id: i });
		if (!ok(response)){
			report(`Grab #${i} failed: ${errorText(response)}`);
		} else
			newRowsCount += response.data.added || 0;
	}
	report(`${newRowsCount} new entries`);

	afterGrab();
}

export async function selectiveGrab(grabberId: number, batchLimit?: number){
	pullCurtain(true);

	const params = {
		id: grabberId,
		...(batchLimit ? { batchLimit } : {})
	};

	updateCurtainMessage(`Grabbing #${grabberId}`);
	const response = await api.post<{ added: number }>("/api/grab", params);
	if (!ok(response)){
		report(`Grab #${grabberId} failed: ${errorText(response)}`);
	} else
		report(`${response.data.added} new entries`);

	afterGrab();
}

async function afterGrab(){
	updateCurtainMessage(`Updating state`);
	const updateGrabbers = await downloadGrabbers();
	const updateModerables = await downloadModerables();

	pullCurtain(false);

	if (updateGrabbers) displayGrabbers(updateGrabbers);
	if (updateModerables) displayModerables(updateModerables);
}

export async function saveGrabbers(){
	const list = el("#grabbers-list");
	const grabs = Array.from(list?.children ?? [])
		.map(child => {
			const container = child as HTMLElement;
			return Grabbers[container?.dataset.grabberForm as GrabberType].read(container);
		});

	pullCurtain(true);
	const response = await api.put<any[]>("/api/grabbers", grabs);
	pullCurtain(false);

	if (ok(response))
		displayGrabbers(response.data);
	else
		report(`Saving grabbers failed: ${errorText(response)}`);
}

export function addGrabber(type: GrabberType){
	const card = renderGrabber(type);
	if (card) el("#grabbers-list")?.append(card);
}

export function renderGrabber(type: GrabberType, index?: number) {
	const meta = Grabbers[type];
	if (!meta) return null;

	// a grabber that isn't saved yet has no index on the server, so it can't grab
	const unsaved = index === undefined;
	const grabButton = (caption: string, batchLimit?: number) => mudcrack({
		tagName: "button",
		className: "lineout",
		contents: caption,
		attributes: { disabled: unsaved ? "" : null },
		events: { click: () => index !== undefined && selectiveGrab(index, batchLimit) }
	});

	const card: HTMLElement = mudcrack({
		className: "lineout grabber list",
		attributes: { "data-grabber-form": type },
		contents: [
			unsaved && mudcrack({ className: "placeholder", contents: "save grabbers before grabbing" }),
			...forms.renderForm(meta.form),
			mudcrack({
				className: "row-wrap",
				contents: [
					grabButton("grab"),
					grabButton("grab less", 50),
					mudcrack({
						tagName: "button",
						className: "lineout",
						contents: "remove",
						events: { click: () => card.remove() }
					})
				]
			})
		]
	});

	return card;
}
