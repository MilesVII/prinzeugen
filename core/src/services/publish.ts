import { sql, type PoolRow } from "../db.ts";
import { env } from "../env.ts";
import { chunk, tg, tgReport, felch, parseTelegramTarget, escapeMarkdown, type TelegramResponse } from "../utils.ts";
import { validateMessage, type Message, type TelegramButton } from "../grabbers/message.ts";

export const PUB_FLAGS = [
	"useproxy",
	"keep",
	"markdownlinks",
	"doubletap",
	"nsfw",
	"sfw"
] as const;
export type PubFlag = typeof PUB_FLAGS[number];

export type PublishExtras = {
	customMarkup?: unknown,
	extraLink?: string | TelegramButton
};

export type PublishRequest = {
	target: string,
	id?: number,
	flags?: PubFlag[],
	count?: number,
	extras?: PublishExtras
};

const imageProxy = (url: string) =>
	`${env.publicUrl}/resize?source=${encodeURIComponent(url)}&randomize=${Math.random()}`;

type ContentType = "img" | "gif" | "vid" | "doc";

async function pingContentUrl(url: string): Promise<{ length: number, type: ContentType } | null> {
	const response = await felch(url, {
		method: "HEAD",
		headers: { "Referer": "https://gelbooru.com/" }
	});
	if (!response.ok) return null;

	const typeRaw = response.headers.get("content-type") || "image/dunno";
	const type: ContentType = typeRaw === "image/gif"
		? "gif"
		: typeRaw.startsWith("image/") ? "img" : "vid";

	return {
		length: parseInt(response.headers.get("content-length") || "0", 10),
		type
	};
}

function linksToMarkdown(links: TelegramButton[]) {
	return links
		.map(button => `[${escapeMarkdown(button.text)}](${escapeMarkdown(button.url)})`)
		.join(" ");
}

function linksToMarkup(links: TelegramButton[]) {
	return { inline_keyboard: chunk(links, 2) };
}

type SendReport = TelegramResponse | string;

/** Returns null on success, or a report describing what was tried */
async function publishToTelegram(
	message: Message,
	token: string,
	target: string | number,
	extras: PublishExtras,
	flags: PubFlag[]
): Promise<null | unknown> {
	const validationErrors = validateMessage(message);
	if (validationErrors.length > 0) return validationErrors;

	function send(type: string, content: string, links: TelegramButton[]): Promise<SendReport> {
		const useMarkdownLinks = flags.includes("markdownlinks") || !!extras.customMarkup;
		const buttons = [...links];

		const messageData: Record<string, unknown> = { chat_id: target };

		if (useMarkdownLinks) {
			messageData.caption = linksToMarkdown(buttons);
			messageData.parse_mode = "MarkdownV2";
		} else {
			messageData.reply_markup = linksToMarkup(buttons);
		}

		if (extras.customMarkup) messageData.reply_markup = extras.customMarkup;

		if (extras.extraLink) {
			const appendix: TelegramButton | null = typeof extras.extraLink === "string"
				? { text: "More", url: extras.extraLink }
				: (extras.extraLink.text && extras.extraLink.url ? extras.extraLink : null);

			if (appendix) {
				if (useMarkdownLinks) {
					messageData.caption += `\n${linksToMarkdown([appendix])}`;
				} else {
					buttons.push(appendix);
					messageData.reply_markup = linksToMarkup(buttons);
				}
			}
		}

		switch (type.trim().toLowerCase()) {
			case "img": return tg("sendPhoto", { ...messageData, photo: content }, token);
			case "gif": return tg("sendAnimation", { ...messageData, animation: content }, token);
			case "vid": return tg("sendVideo", { ...messageData, video: content }, token);
			case "doc": return tg("sendDocument", { ...messageData, document: content }, token);
			default: return Promise.resolve("Can't detect content type to send to Tg");
		}
	}
	const sent = (report: SendReport) => typeof report !== "string" && report.ok;

	if (message.version === 2) {
		const report = await send(message.type, message.id, message.links.map(url => ({ text: "link", url })));
		return sent(report) ? null : report;
	}

	// gelbooru rotates image hosts; these rewrites match what currently resolves
	const content = message.content
		.replace(/https:\/\/img.\./g, "https://img4.")
		.replace(/video-cdn.\./g, "video-cdn4.");
	message.content = content;

	const meta = await pingContentUrl(content);
	if (!meta) return `No head?\n${content}`;

	const report: Record<string, unknown> = {};

	report.direct = await send(meta.type, content, message.links);
	if (sent(report.direct as SendReport)) return null;

	if (message.version === 3) {
		if (message.cached && message.cachedContent) {
			report.fromCache = await send(meta.type, imageProxy(message.cachedContent.content), message.links);
			if (sent(report.fromCache as SendReport)) return null;
		}
		if (meta.type === "img") {
			report.proxy = await send(meta.type, imageProxy(content), message.links);
			if (sent(report.proxy as SendReport)) return null;
		}
		return report;
	}

	report.proxy = await send(meta.type === "img" ? "img" : "vid", imageProxy(content), message.links);
	if (sent(report.proxy as SendReport)) return null;
	report.url = content;
	return report;
}

export type PublishOutcome =
	| { status: "bad-target" }
	| { status: "empty" }
	| { status: "done", published: number, failed: number };

export async function publish(user: number, request: PublishRequest): Promise<PublishOutcome> {
	const flags = request.flags ?? [];
	const target = parseTelegramTarget(request.target);
	if (target === null) return { status: "bad-target" };

	const count = request.count ?? 1;
	const ratingFilter = flags.includes("sfw") ? "sfw" : flags.includes("nsfw") ? "nsfw" : null;

	const availablePosts = await sql<(PoolRow & { tg_token: string | null })[]>`
		select pool.*, users.tg_token
			from pool inner join users on pool."user" = users."id"
			where
				pool."user" = ${user}
				and not exists (
					select 1
					from published_logs l
					where l.post_id = pool.id
						and l.target = ${String(target)}
				)
				and pool."approved" = true
				${request.id !== undefined
					? sql`and pool."id" = ${request.id}`
					: sql`and pool."failed" = false`
				}
				${ratingFilter === "nsfw"
					? sql`
						and (pool."message"->>'version')::int = 4
						and (pool."message"->>'rating') = 'explicit'
					`
					: ratingFilter === "sfw"
						? sql`
							and (pool."message"->>'version')::int = 4
							and (pool."message"->>'nsfw')::boolean = false
						`
						: sql``
				}
			order by random()
			limit ${count * 2}
	`;

	if (availablePosts.length === 0) return { status: "empty" };

	let published = 0;
	let failed = 0;
	let doubleTapFuze = true;
	for (let tasksLeft = count; tasksLeft > 0; --tasksLeft) {
		const post = availablePosts.pop();
		if (!post) break;

		const error = await publishToTelegram(post.message, post.tg_token ?? "", target, request.extras ?? {}, flags);

		if (error) {
			++failed;
			if (flags.includes("doubletap") && availablePosts.length > 0 && doubleTapFuze) {
				++tasksLeft;
				doubleTapFuze = false;
			}
			if (typeof error === "string" && error.startsWith("No head")) {
				await tgReport(`Failed to publish post #${post.id}.\nResponse:\n${error}`);
			} else {
				await Promise.allSettled([
					tgReport(`Failed to publish post #${post.id}.\nResponse:\n${JSON.stringify(error, null, "\t")}`),
					sql`update pool set failed = true where id = ${post.id}`
				]);
			}
		} else {
			++published;
			if (flags.includes("keep")) {
				await sql`insert into published_logs ${sql({ post_id: post.id, target: String(target) })}`;
			} else {
				await sql`delete from published_logs where post_id = ${post.id}`;
				await sql`delete from pool where id = ${post.id}`;
			}
		}
	}

	return { status: "done", published, failed };
}
