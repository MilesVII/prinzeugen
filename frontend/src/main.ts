import { callAPI, safe, setElementValue, load, save, fromTemplate } from "./utils/utils";
import type { GrabberType } from "./utils/grabbers"
import { listenToKeyboard } from "./utils/io";
import { updateTabListeners, switchTabContent } from "./utils/tabs";
import { pullCurtain } from "./utils/curtain";
import { genericFlickerUpdate } from "./utils/flicker";
import { init as initConsole, report } from "./utils/console";
import { init as initTheme, selectorList as themeSelectorList } from "./utils/themes";

import { addGrabber, saveGrabbers, displayGrabbers, batchGrab } from "./grabbing";
import { decide, moveFocus, fixFocus, upscalePreviews, displayModerables, moderate, reloadModerables } from "./moderation";
import { loadMessagePool } from "./pool";
import { flushTasks } from "./utils/upscaler";
import { refeed } from "./gb-feeder";

main();

async function main(){
	initTheme();

	updateTabListeners();

	window.addEventListener("error", (event) => {
		report(`${event.message}\n\n${event.filename} ${event.lineno}:${event.colno}`);
	});
	document.querySelector("#form-login")?.addEventListener("submit", e => login(e));

	const loginData = load("login");
	if (loginData != null){
		pullCurtain(true, "Loading");

		const loginResponse = await callAPI("login", {
			user: loginData.id,
			userToken: loginData.token
		}, false);

		pullCurtain(false);

		if (loginResponse.status == 200)
			authorize(loginResponse.data);
	}

	listenToKeyboard(false, [
		{
			keys: ["Comma"],
			action: () => decide(true)
		},
		{
			keys: ["Period"],
			action: () => decide(false)
		},
		{
			keys: ["Digit0"],
			action: () => upscalePreviews()
		},
		{
			keys: ["ShiftRight", "KeyM"],
			action: () => fixFocus()
		}
	]);
}

async function authorize(userData: any){
	switchTabContent("state", "online");

	setElementValue("#dashboard-api", [
		`{`,
		`	"action": "publish",`,
		`	"target": "",`,
		`	"count": 1,`,
		`	"flags": ["doubletap"]`,
		`}`
	].join("\n"));
	document
		.querySelector<HTMLTextAreaElement>("#dashboard-api")
		?.addEventListener("input", updateAPICallButton);

	setElementValue("#settings-password", "");
	setElementValue("#settings-tg-token", userData.tg_token);
	setElementValue("#settings-additional", userData.additional);
	document
		.querySelector<HTMLTextAreaElement>("#settings-additional")
		?.addEventListener("input", updateSettingsFlicker);
	updateSettingsFlicker();

	document
		.querySelectorAll<HTMLElement>("[data-add-grabber]")
		.forEach(b =>
			b.addEventListener("click", () => {
				if (b.dataset.addGrabber === undefined) return;
				addGrabber(b.dataset.addGrabber as GrabberType)
			})
		);

	function addClick(query: string, action: () => void) {
		document
			.querySelector<HTMLElement>(query)
			?.addEventListener("click", action);
	}
	function preventDefault(query: string) {
		document
			.querySelector<HTMLElement>(query)
			?.addEventListener("mousedown", e => e.preventDefault());
	}

	addClick("#dashboard-grab", batchGrab);
	addClick("#dashboard-api-submit", manualAPICall);
	addClick("#refeeder-button", refeed);
	addClick("#grabbers-save", saveGrabbers);
	addClick("#moderables-reload", reloadModerables);
	addClick("#moderables-upscale", upscalePreviews);
	addClick("#moderables-upscale-abort", flushTasks)
	addClick("#moderables-submit", moderate);
	addClick("#pool-load", () => loadMessagePool()); // do not unwrap, will pass event that overrides default page param
	addClick("#settings-save", saveSettings);
	addClick("#settings-signout", signOut);

	addClick("#mobile-controls-up", () => moveFocus(false));
	addClick("#mobile-controls-approve", () => decide(true));
	addClick("#mobile-controls-down", () => moveFocus(true));
	addClick("#mobile-controls-reject", () => decide(false));

	preventDefault("#mobile-controls-up");
	preventDefault("#mobile-controls-approve");
	preventDefault("#mobile-controls-down");
	preventDefault("#mobile-controls-reject");

	initConsole();

	document.querySelector("#settings-theme")?.append(themeSelectorList());

	displayGrabbers(userData.grabbers);
	displayModerables(userData.moderables);

	report(`Welcome back, ${userData.name}. You have ${userData.stats.approved} post${userData.stats.approved == 1 ? "" : "s"} in pool, ${userData.stats.pending} pending moderation, ${userData.stats.failed} failed`);
}

async function login(e: Event){
	e.preventDefault();
	const id = document.querySelector<HTMLInputElement>("#login-id")?.value;
	const token = document.querySelector<HTMLInputElement>("#login-token")?.value ?? "";

	if (!id) return;

	if (!pullCurtain(true)) return;

	const parsedId = safe(() => parseInt(id, 10)) || 0;
	const response = await callAPI("login", {
		user: parsedId,
		userToken: token
	}, false);

	pullCurtain(false);
	if (response.status == 200) {
		save("login", {
			id: parsedId,
			token: token
		});
		authorize(response.data);
	}

	return false;
}

function getManualAPICallText(){
	const area = document.querySelector<HTMLTextAreaElement>("#dashboard-api");
	return area?.value ?? null;
}
function updateAPICallButton(){
	const query = getManualAPICallText();
	const button = document.querySelector<HTMLButtonElement>("#dashboard-api-submit");
	if (!button) return;

	const parsed = safe(() => JSON.parse(query ?? ""));
	const valid = parsed !== null && parsed?.action ;
	button.disabled = !valid;
}
async function manualAPICall(){
	const query = getManualAPICallText();
	if (!query) return;

	pullCurtain(true);
	const response = await callAPI("ACTION NOT SPECIFIED", JSON.parse(query), true);
	pullCurtain(false);
	report(`status: ${response.status}\n${response.data}`);
}

function updateSettingsFlicker(){
	genericFlickerUpdate("#settings-additional", "#settings-flicker",
		contents => {
			if (contents){
				const parsed = safe(() => JSON.parse(contents));
				if (parsed === null){
					return ["Not JSON", "hsla(20, 72%, 23%, .42)"];
				} else {
					return ["JSON", "hsla(100, 72%, 23%, .42)"];
				}
			} else {
				return ["Empty", "hsla(0, 0%, 60%, .42)"];
			}
		}
	);
}

async function saveSettings(){
	const newPassword = document.querySelector<HTMLInputElement>("#settings-password")?.value.trim() || null;
	const tgToken = document.querySelector<HTMLInputElement>("#settings-tg-token")?.value || null;
	const additionals = document.querySelector<HTMLTextAreaElement>("#settings-additional")?.value ?? "";

	pullCurtain(true);
	await callAPI("saveSettings", {
		newUserToken: newPassword,
		newTgToken: tgToken,
		additionalData: additionals
	}, true);
	pullCurtain(false);
	if (newPassword) signOut();
}

function signOut(){
	save("login", null);
	switchTabContent("state", "login");
}
