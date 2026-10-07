import { define as defineTabs, switchTab } from "./components/tabs";
import { define as definePages } from "./components/pagination";
import {
	api, ok, errorText, safe, setElementValue, getSession, setSession,
	fromTemplateFirst, el, formatDate, isTyping, type Method
} from "./utils/utils";
import type { GrabberType } from "./utils/grabbers";
import { listenToKeyboard } from "./utils/io";
import { pullCurtain } from "./utils/curtain";
import { genericFlickerUpdate } from "./utils/flicker";
import { init as initConsole, report } from "./utils/console";
import { initTheme, renderThemeSelectors } from "./utils/themes";

import { addGrabber, saveGrabbers, displayGrabbers, batchGrab } from "./grabbing";
import { decide, moveFocus, fixFocus, upscalePreviews, displayModerables, moderate, reloadModerables } from "./moderation";
import { initPool, loadMessagePool } from "./pool";
import { flushTasks } from "./utils/upscaler";
import { refeed, refreshFeederList, updateFeederList, initFeederCredentials } from "./gb-feeder";
import { mudcrack } from "rampike";

type User = {
	id: number,
	name: string | null,
	role: "admin" | "user",
	can_invite: boolean,
	tg_token: string | null,
	additional: string | null,
	grabbers: any[] | null
};
type UserBundle = {
	user: User,
	moderables: any[],
	stats: { approved: number, pending: number, failed: number }
};

const MAIN_TABS = ["dash", "feed", "grab", "mode", "pool", "sets"];
const API_TEMPLATE = [
	`{`,
	`	"target": "",`,
	`	"count": 1,`,
	`	"flags": ["doubletap"]`,
	`}`
].join("\n");

let currentUser: User | null = null;
let wired = false;

defineTabs();
definePages();
main();

async function main(){
	initTheme();
	initConsole();

	window.addEventListener("error", event => {
		report(`${event.message}\n${event.filename} ${event.lineno}:${event.colno}`);
	});
	window.addEventListener("unhandledrejection", event => {
		const reason = event.reason;
		report(`Unhandled: ${reason instanceof Error ? reason.message : String(reason)}`);
	});
	window.addEventListener("pe:unauthorized", () => {
		if (!getSession()) return;
		report("Session expired, sign in again");
		signOut(false);
	});

	el("#form-login")?.addEventListener("submit", e => login(e));

	listenToKeyboard(false, [
		{ keys: ["Comma"], action: () => !isTyping() && decide(true) },
		{ keys: ["Period"], action: () => !isTyping() && decide(false) },
		{ keys: ["Digit0"], action: () => !isTyping() && upscalePreviews() },
		{ keys: ["ShiftRight", "KeyM"], action: () => !isTyping() && fixFocus() }
	]);

	if (getSession()) {
		pullCurtain(true, "Loading");
		const response = await api.get<UserBundle>("/api/me");
		pullCurtain(false);

		if (ok(response))
			authorize(response.data);
		else if (response.status !== 401)
			report(`Could not restore session: ${errorText(response)}`);
	}
}

function wire() {
	function addClick(query: string, action: () => void) {
		el(query)?.addEventListener("click", action);
	}
	function preventDefault(query: string) {
		el(query)?.addEventListener("mousedown", e => e.preventDefault());
	}

	el<HTMLTextAreaElement>("#dashboard-api")?.addEventListener("input", updateAPICallButton);
	el<HTMLInputElement>("#dashboard-api-path")?.addEventListener("input", updateAPICallButton);
	el<HTMLTextAreaElement>("#settings-additional")?.addEventListener("input", updateSettingsFlicker);

	document
		.querySelectorAll<HTMLElement>("[data-add-grabber]")
		.forEach(b =>
			b.addEventListener("click", () => {
				if (b.dataset.addGrabber === undefined) return;
				addGrabber(b.dataset.addGrabber as GrabberType);
			})
		);

	addClick("#dashboard-grab", batchGrab);
	addClick("#dashboard-api-submit", manualAPICall);
	addClick("#refeeder-button", refeed);
	addClick("#refeeder-view", refreshFeederList);
	addClick("#refeeder-update", updateFeederList);
	addClick("#grabbers-save", saveGrabbers);
	addClick("#moderables-reload", reloadModerables);
	addClick("#moderables-upscale", upscalePreviews);
	addClick("#moderables-upscale-abort", flushTasks);
	addClick("#moderables-submit", moderate);
	addClick("#pool-load", () => loadMessagePool()); // do not unwrap, will pass event that overrides default page param
	addClick("#settings-save", saveSettings);
	addClick("#settings-password-save", changePassword);
	addClick("#settings-token-create", createApiToken);
	addClick("#settings-user-create", createUser);
	addClick("#settings-signout", () => signOut(true));

	addClick("#mobile-controls-up", () => moveFocus(false));
	addClick("#mobile-controls-approve", () => decide(true));
	addClick("#mobile-controls-down", () => moveFocus(true));
	addClick("#mobile-controls-reject", () => decide(false));

	preventDefault("#mobile-controls-up");
	preventDefault("#mobile-controls-approve");
	preventDefault("#mobile-controls-down");
	preventDefault("#mobile-controls-reject");

	initPool();
	initFeederCredentials();

	// hash routing for the main tabs, so reloads and back/forward keep the page
	el("#tabs-main")?.addEventListener("tab-pick", e => {
		const tab = (e as CustomEvent<{ tab: string }>).detail.tab;
		history.replaceState(null, "", `#${tab}`);
	});
	window.addEventListener("hashchange", applyHash);
}

function applyHash() {
	if (!currentUser) return;
	const tab = window.location.hash.slice(1);
	if (MAIN_TABS.includes(tab)) switchTab("tabs-main", tab);
}

function authorize(bundle: UserBundle){
	const user = bundle.user;
	currentUser = user;

	if (!wired) {
		wire();
		wired = true;
	}

	switchTab("state", "online");

	const displayName = user.name ?? `#${user.id}`;
	const topbarUser = el("#topbar-user");
	if (topbarUser) topbarUser.textContent = user.role === "admin" ? `${displayName} · admin` : displayName;

	renderStats(bundle.stats);

	setElementValue("#dashboard-api", API_TEMPLATE);
	updateAPICallButton();

	setElementValue("#settings-password-current", "");
	setElementValue("#settings-password", "");
	setElementValue("#settings-tg-token", user.tg_token ?? "");
	setElementValue("#settings-additional", user.additional ?? "");
	updateSettingsFlicker();

	const usersSection = el("#settings-users-section");
	if (usersSection) usersSection.hidden = !(user.role === "admin" || user.can_invite);
	const permissions = el("#settings-user-permissions");
	if (permissions) permissions.hidden = user.role !== "admin";

	const themes = el("#settings-theme");
	if (themes) renderThemeSelectors(themes);

	displayGrabbers(user.grabbers ?? []);
	displayModerables(bundle.moderables);
	refreshFeederList();
	loadApiTokens();
	if (user.role === "admin") loadUsers();

	applyHash();

	const s = bundle.stats;
	report(`Welcome back, ${displayName}. You have ${s.approved} post${s.approved == 1 ? "" : "s"} in pool, ${s.pending} pending moderation, ${s.failed} failed`);
}

function renderStats(stats: UserBundle["stats"]) {
	document.querySelectorAll<HTMLElement>("[data-stat]").forEach(e => {
		const key = e.dataset.stat as keyof UserBundle["stats"];
		e.textContent = `${stats[key] ?? "–"}`;
	});
}

async function login(e: Event){
	e.preventDefault();
	const identifier = el<HTMLInputElement>("#login-id")?.value.trim() ?? "";
	const passwordInput = el<HTMLInputElement>("#login-token");
	const password = passwordInput?.value ?? "";
	const errorBox = el("#login-error");

	if (!identifier || !password) return;
	if (!pullCurtain(true, "Signing in")) return;

	const response = await api.post<UserBundle & { token: string }>("/api/login", { identifier, password }, false);

	pullCurtain(false);
	if (ok(response)) {
		setSession({ token: response.data.token });
		if (passwordInput) passwordInput.value = "";
		if (errorBox) errorBox.hidden = true;
		authorize(response.data);
	} else if (errorBox) {
		errorBox.textContent = errorText(response, "Sign in failed");
		errorBox.hidden = false;
	}
}

async function signOut(remote: boolean){
	if (remote && getSession()) {
		pullCurtain(true, "Signing out");
		await api.post("/api/logout");
		pullCurtain(false);
	}
	setSession(null);
	currentUser = null;
	switchTab("state", "login");
	switchTab("tabs-main", "dash");
	history.replaceState(null, "", window.location.pathname);
}

function readManualCall() {
	const method = (el<HTMLSelectElement>("#dashboard-api-method")?.value ?? "POST") as Method;
	const path = el<HTMLInputElement>("#dashboard-api-path")?.value.trim() ?? "";
	const raw = el<HTMLTextAreaElement>("#dashboard-api")?.value.trim() ?? "";
	const body = raw ? safe(() => JSON.parse(raw)) : undefined;
	const valid = path.startsWith("/") && (raw === "" || body !== null);
	return { method, path, body: body ?? undefined, valid };
}
function updateAPICallButton(){
	const button = el<HTMLButtonElement>("#dashboard-api-submit");
	if (button) button.disabled = !readManualCall().valid;
}
async function manualAPICall(){
	const call = readManualCall();
	if (!call.valid) return;

	pullCurtain(true);
	const response = await api.request(call.method, call.path, call.method === "GET" ? undefined : call.body, true);
	pullCurtain(false);
	const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data, null, 2);
	report(`${call.method} ${call.path} → ${response.status}\n${body}`);
}

function updateSettingsFlicker(){
	genericFlickerUpdate("#settings-additional", "#settings-flicker",
		contents => {
			if (!contents) return ["empty", undefined];
			return safe(() => JSON.parse(contents)) === null
				? ["not json", "bad"]
				: ["json", "ok"];
		}
	);
}

async function saveSettings(){
	const tgToken = el<HTMLInputElement>("#settings-tg-token")?.value ?? "";
	const additional = el<HTMLTextAreaElement>("#settings-additional")?.value ?? "";

	pullCurtain(true);
	const response = await api.patch("/api/settings", { tgToken, additional });
	pullCurtain(false);
	report(ok(response) ? "Settings saved" : `Saving failed: ${errorText(response)}`);
}

async function changePassword(){
	const current = el<HTMLInputElement>("#settings-password-current");
	const fresh = el<HTMLInputElement>("#settings-password");
	const currentPassword = current?.value ?? "";
	const newPassword = fresh?.value ?? "";
	if (!currentPassword || !newPassword) {
		report("Both current and new password are required");
		return;
	}

	pullCurtain(true);
	const response = await api.post("/api/password", { currentPassword, newPassword });
	pullCurtain(false);

	if (ok(response)) {
		if (current) current.value = "";
		if (fresh) fresh.value = "";
		report("Password changed. Other browser sessions were signed out.");
	} else {
		report(`Password change failed: ${errorText(response)}`);
	}
}

type ApiToken = { id: number, name: string | null, created_at: string, last_used_at: string | null };
async function loadApiTokens() {
	const list = el("#settings-token-list");
	if (!list) return;

	const response = await api.get<ApiToken[]>("/api/tokens");
	if (!ok(response)) return;

	list.querySelectorAll(".token-item").forEach(e => e.remove());
	response.data.forEach(token => {
		const item = fromTemplateFirst("template-token-item");
		if (!item) return;
		const name = item.querySelector("[data-field=name]");
		const meta = item.querySelector("[data-field=meta]");
		if (name) name.textContent = token.name ?? `token #${token.id}`;
		if (meta) meta.textContent = `created ${formatDate(token.created_at)} · last used ${formatDate(token.last_used_at)}`;
		item.querySelector("[data-action=revoke]")?.addEventListener("click", async () => {
			pullCurtain(true);
			await api.del(`/api/tokens/${token.id}`);
			pullCurtain(false);
			loadApiTokens();
		});
		list.append(item);
	});
}

async function createApiToken() {
	const nameInput = el<HTMLInputElement>("#settings-token-name");
	const list = el("#settings-token-list");
	const name = nameInput?.value.trim() || "api";

	pullCurtain(true);
	const response = await api.post<{ id: number, name: string, token: string }>("/api/tokens", { name });
	pullCurtain(false);

	if (!ok(response)) {
		report(`Token creation failed: ${errorText(response)}`);
		return;
	}
	if (nameInput) nameInput.value = "";

	const reveal = mudcrack({
		className: "lineout list",
		contents: [
			mudcrack({
				className: "hint",
				contents: `"${response.data.name}" created. Copy it now, it will not be shown again.`
			}),
			mudcrack({
				className: "lineout token-reveal",
				contents: response.data.token
			}),
			mudcrack({
				tagName: "button",
				className: "lineout fit",
				contents: "dismiss",
				events: {
					click: () => reveal.remove()
				}
			})
		]
	});

	list?.querySelectorAll(".token-reveal").forEach(e => e.parentElement?.remove());
	list?.prepend(reveal);
	loadApiTokens();
}

type UserRow = { id: number, name: string | null, role: string, can_invite: boolean, has_password: boolean, created_at: string };
async function loadUsers() {
	const list = el("#settings-user-list");
	if (!list) return;

	const response = await api.get<UserRow[]>("/api/users");
	if (!ok(response)) return;

	list.innerHTML = "";
	response.data.forEach(user => {
		const item = fromTemplateFirst("template-user-item");
		if (!item) return;
		const id = item.querySelector("[data-field=id]");
		const name = item.querySelector("[data-field=name]");
		const meta = item.querySelector("[data-field=meta]");
		if (id) id.textContent = `#${user.id}`;
		if (name) name.textContent = user.name ?? "(unnamed)";
		if (meta) meta.textContent = [
			user.role,
			user.can_invite && user.role !== "admin" ? "can invite" : null,
			user.has_password ? null : "no password"
		].filter(Boolean).join(" · ");
		list.append(item);
	});
}

async function createUser() {
	const nameInput = el<HTMLInputElement>("#settings-user-name");
	const passwordInput = el<HTMLInputElement>("#settings-user-password");
	const inviteInput = el<HTMLInputElement>("#settings-user-invite");
	const adminInput = el<HTMLInputElement>("#settings-user-admin");

	const name = nameInput?.value.trim() ?? "";
	const password = passwordInput?.value ?? "";
	if (!name || !password) {
		report("Name and password are required");
		return;
	}

	const isAdmin = currentUser?.role === "admin";
	const payload: Record<string, unknown> = { name, password };
	if (isAdmin) {
		payload.canInvite = !!inviteInput?.checked;
		payload.admin = !!adminInput?.checked;
	}

	pullCurtain(true);
	const response = await api.post<UserRow>("/api/users", payload);
	pullCurtain(false);

	if (ok(response)) {
		if (nameInput) nameInput.value = "";
		if (passwordInput) passwordInput.value = "";
		if (inviteInput) inviteInput.checked = false;
		if (adminInput) adminInput.checked = false;
		report(`User "${response.data.name}" created with id ${response.data.id}`);
		if (isAdmin) loadUsers();
	} else {
		report(`User creation failed: ${errorText(response)}`);
	}
}
