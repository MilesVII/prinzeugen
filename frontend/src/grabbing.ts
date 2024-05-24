import { callAPI, fromTemplate } from "./utils/utils";
import { Grabbers } from "./utils/grabbers";
import type { Grabber, GrabberType } from "./utils/grabbers"
import { pullCurtain, updateCurtainMessage } from "./utils/curtain";
import { report } from "./utils/console";
import { downloadModerables, displayModerables } from "./moderation";

import * as forms from "./utils/forms";

export async function downloadGrabbers(): Promise<any[] | null> {
	const grabbers = await callAPI("getGrabbers", {}, true);
	if (grabbers.status == 200)
		return grabbers.data;
	else
		return null;
}

export function displayGrabbers(grabs: any[]){
	const list = document.querySelector<HTMLElement>("#grabbers-list");
	if (!list) return;
	list.innerHTML = "";

	grabs.forEach((g, i) => {
		const meta: Grabber = Grabbers[g.type as GrabberType];
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
		const response = await callAPI("grab", {id: i}, true);
		if (response.status != 200){
			report(`Grab #${i} failed`);
			console.error(response);
		} else
			newRowsCount += parseInt(response.data, 10) || 0;
	}
	report(`${newRowsCount} new entries`);

	afterGrab();
}

export async function selectiveGrab(grabberId: number, batchSize?: number){
	pullCurtain(true);

	const params = {
		id: grabberId,
		...(batchSize ? {batchSize: batchSize} : {})
	};

	updateCurtainMessage(`Grabbing #${grabberId}`);
	const response = await callAPI("grab", params, true);
	if (response.status != 200){
		report(`Grab #${grabberId} failed`);
		console.error(response);
	} else
		report(`${response.data} new entries`);

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
	const list = document.querySelector<HTMLElement>("#grabbers-list");
	const grabs = Array.from(list?.children ?? [])
		.map(el => {
			const container = el as HTMLElement;
			return Grabbers[container?.dataset.grabberForm as GrabberType].read(container)
		});
	

	pullCurtain(true);
	const response = await callAPI("setGrabbers", {
		grabbers: grabs
	});

	const updateGrabbers = response.status === 200 ? await downloadGrabbers() : null;
	pullCurtain(false);
	if (updateGrabbers) displayGrabbers(updateGrabbers);
}

export function addGrabber(type: GrabberType){
	const list = document.querySelector("#grabbers-list");
	const proto = renderGrabber(type);
	if (proto && list) list.appendChild(proto);
}

export function renderGrabber(type: GrabberType, index?: number) {
	const meta = Grabbers[type];
	if (!meta) return null;

	const proto = (fromTemplate("generic-grabber") as Element)?.firstElementChild as HTMLElement;
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
		hint.textContent = "Save grabbers before grabbing";
		proto.insertBefore(hint, proto.children[0]);
		if (grab) grab.disabled = true;
		if (less) less.disabled = true;
	} else {
		if (grab) grab.addEventListener("click", () => selectiveGrab(index));
		if (less) less.addEventListener("click", () => selectiveGrab(index, 50));
	}
	
	proto.appendChild(buttons);

	return proto as HTMLElement;
}