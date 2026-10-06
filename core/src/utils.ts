import { fetch as nbFetch } from "netbun";
import { env } from "./env.ts";

export function safeParse(str: string): any {
	try {
		return JSON.parse(str);
	} catch {
		return null;
	}
}

export function last<T>(arr: T[]): T | undefined {
	return arr[arr.length - 1];
}

export function range(from: number, to: number) {
	const r: number[] = [];
	for (let i = from; i < to; ++i)
		r.push(i);
	return r;
}

export function chunk<T>(a: T[], chunksize: number): T[][] {
	const r: T[][] = [];
	for (let i = 0; i < a.length; i += chunksize){
		r.push(a.slice(i, i + chunksize));
	}
	return r;
}

export function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export type TelegramResponse = { ok: true, result?: unknown } | { ok: false, description?: string, error_code?: number, raw?: string };

export async function tg(command: string, payload: Record<string, unknown>, token = env.tgToken): Promise<TelegramResponse> {
	const response = await fetch(`https://api.telegram.org/bot${token}/${command}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload)
	});
	const raw = await response.text();
	const parsed = safeParse(raw);
	if (parsed && typeof parsed.ok === "boolean") return parsed;
	return { ok: false, raw };
}

export function tgReport(message: string, token?: string) {
	return tg("sendMessage", {
		chat_id: env.tgTargetMe,
		text: message
	}, token);
}

export function parseTelegramTarget(raw: string): string | number | null {
	const trimmed = raw.trim();
	if (trimmed.startsWith("@")) return trimmed;
	const parsed = parseInt(trimmed, 10);
	return isNaN(parsed) ? null : parsed;
}

//https://github.com/edwmurph/escape-markdown/blob/master/index.js
export function escapeMarkdown(raw: string){
	const substitutions: Record<string, string> = {'*': '\\*','#': '\\#','(': '\\(',')': '\\)','[': '\\[',']': '\\]',_: '\\_','\\': '\\\\','+': '\\+','-': '\\-','`': '\\`','<': '&lt;','>': '&gt;','&': '&amp;', '.': '\\.'};

	return raw.replace(/./g, m => substitutions[m] ?? m);
}

/** Outbound fetch for gelbooru media. Goes through OUTBOUND_PROXY (socks5/http) when configured. */
export function felch(url: string, params: RequestInit = {}): Promise<Response> {
	if (!env.outboundProxy) return fetch(url, params);
	return nbFetch(url, {
		...params,
		proxy: env.outboundProxy,
	} as any) as Promise<Response>;
}

export function hostAllowed(host: string, allowed: string[]) {
	const h = host.toLowerCase();
	return allowed.some(a => h === a || h.endsWith(`.${a}`));
}
