const SESSION_KEY = "session";

export type Session = { token: string };
export type APIResponse<T = any> = {
	status: number,
	data: T
};
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function getSession(): Session | null {
	const stored = load(SESSION_KEY);
	return stored && typeof stored.token === "string" ? stored : null;
}
export function setSession(session: Session | null) {
	save(SESSION_KEY, session);
}

/**
 * JSON request to the server. Attaches the bearer token when one is stored and `useLogin` is set.
 * A 401 while holding a session fires "pe:unauthorized" on window so the UI can drop to the login screen.
 */
async function request<T = any>(method: Method, path: string, body?: unknown, useLogin = true): Promise<APIResponse<T>> {
	const headers: Record<string, string> = {};
	const session = useLogin ? getSession() : null;
	if (session) headers["Authorization"] = `Bearer ${session.token}`;
	if (body !== undefined) headers["Content-Type"] = "application/json";

	const response = await fetch(path, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});

	const raw = await response.text();
	const payload = safe(() => JSON.parse(raw)) ?? raw;

	if (!response.ok) console.error(method, path, response.status, raw);
	if (response.status === 401 && session)
		window.dispatchEvent(new CustomEvent("pe:unauthorized"));

	return {
		status: response.status,
		data: payload as T
	};
}

export const api = {
	request,
	get:   <T = any>(path: string) => request<T>("GET", path),
	post:  <T = any>(path: string, body?: unknown, useLogin = true) => request<T>("POST", path, body ?? {}, useLogin),
	put:   <T = any>(path: string, body: unknown) => request<T>("PUT", path, body),
	patch: <T = any>(path: string, body: unknown) => request<T>("PATCH", path, body),
	del:   <T = any>(path: string) => request<T>("DELETE", path)
};

export function ok(response: APIResponse) {
	return response.status >= 200 && response.status < 300;
}

/** Human-readable error from a failed response, including Elysia validation summaries */
export function errorText(response: APIResponse, fallback = "Request failed") {
	const data = response.data;
	if (typeof data === "string" && data.trim()) return data;
	if (data && typeof data === "object") {
		if (typeof data.summary === "string") return data.summary;
		if (typeof data.message === "string") return data.message;
		return JSON.stringify(data, null, 2);
	}
	return `${fallback} (${response.status})`;
}

export function el<T extends Element = HTMLElement>(query: string, root: ParentNode = document) {
	return root.querySelector<T>(query);
}

export function fromTemplate(id: string) {
	return document.querySelector<HTMLTemplateElement>(`template#${id}`)?.content.cloneNode(true) as DocumentFragment | null ?? null;
}

export function fromTemplateFirst<T extends HTMLElement = HTMLElement>(id: string): T | null {
	const fragment = fromTemplate(id);
	return (fragment?.firstElementChild as T | null) ?? null;
}

export function safe<T>(cb: () => T): T | null {
	try {
		return cb();
	} catch(e){
		return null;
	}
}

export function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export function setElementValue(query: string, value: any, propertyName = "value") {
	const e = document.querySelector(query);
	if (e === null) return;
	(e as any)[propertyName] = value;
}

export function load(key: string) {
	return safe(() => JSON.parse(localStorage.getItem(key) || "null"));
}

export function save(key: string, data: any) {
	if (data)
		localStorage.setItem(key, JSON.stringify(data));
	else
		localStorage.removeItem(key);
}

export function zip
	<A extends Record<any, any>, B extends Record<any, any>>
	(a: A[], b: B[]): (A & B)[] {
	const [base, added] = a.length < b.length ? [a, b] : [b, a];

	return base.map((value, index) => ({...value, ...added[index]}));
}

export function formatDate(raw: string | null | undefined) {
	if (!raw) return "never";
	const date = new Date(raw);
	return isNaN(date.getTime()) ? String(raw) : date.toLocaleString();
}

export function isTyping() {
	const active = document.activeElement as HTMLElement | null;
	if (!active) return false;
	return ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName) || active.isContentEditable;
}
