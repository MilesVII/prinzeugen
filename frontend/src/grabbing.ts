import { api, ok, errorText, fromTemplateFirst, el } from "./utils/utils";
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
	list.innerHTML = "";

	grabs.forEach((g, i) => {
		const meta: Grabber | undefined = Grabbers[g.type as GrabberType];
		if (!meta) return;
		const proto = renderGrabber(g.type, i);
		if (!proto) return;

		meta.fill(proto, g);

		list.appendChild(proto);
	});
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
	const list = el("#grabbers-list");
	const proto = renderGrabber(type);
	if (proto && list) list.appendChild(proto);
}

export function renderGrabber(type: GrabberType, index?: number) {
	const meta = Grabbers[type];
	if (!meta) return null;

	const proto = fromTemplateFirst("generic-grabber");
	if (!proto) return null;
	const buttons = proto.querySelector("div");
	if (!buttons) return null;

	proto.dataset.grabberForm = type;

	proto.appendChild(forms.renderForm(meta.form));

	const [grab, less, remv] = [
		buttons.querySelector<HTMLButtonElement>(`[data-grabber-button="grab"]`),
		buttons.querySelector<HTMLButtonElement>(`[data-grabber-button="less"]`),
		buttons.querySelector<HTMLButtonElement>(`[data-grabber-button="remv"]`)
	];

	remv?.addEventListener("click", () => {
		proto.remove();
	});

	if (index === undefined){
		const hint = document.createElement("div");
		hint.className = "placeholder";
		hint.textContent = "save grabbers before grabbing";
		proto.insertBefore(hint, proto.children[0] ?? null);
		if (grab) grab.disabled = true;
		if (less) less.disabled = true;
	} else {
		if (grab) grab.addEventListener("click", () => selectiveGrab(index));
		if (less) less.addEventListener("click", () => selectiveGrab(index, 50));
	}

	proto.appendChild(buttons);

	return proto;
}
