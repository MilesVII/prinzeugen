import { t, type Static } from "elysia";
import { last, safeParse, range, sleep } from "../utils.ts";
import type { Grabber } from "./index.ts";
import type { Message, TelegramButton } from "./message.ts";

export const GelbooruConfigSchema = t.Object({
	type: t.Literal("gelbooru"),
	credentials: t.Object({
		user: t.Number(),
		token: t.String()
	}),
	config: t.Object({
		tags: t.Array(t.String()),
		whites: t.Array(t.String()),
		blacks: t.Array(t.String()),
		moderated: t.Boolean()
	}),
	state: t.Object({
		lastSeen: t.Number()
	})
});
export type GelbooruConfig = Static<typeof GelbooruConfigSchema>;

function button(text: string, url: string): TelegramButton {
	return { text, url };
}

function buildURLParams(params: Record<string, string | number | boolean>) {
	return Object.keys(params)
		.map(k => `${k}=${encodeURIComponent(params[k]!)}`)
		.join("&");
}

async function filterArtists(allTags: string[], u: number, t: string): Promise<null | string[]> {
	async function phetchTagsPage(page: number) {
		const params = buildURLParams({
			api_key: t,
			user_id: u,
			page: "dapi",
			s: "tag",
			q: "index",
			pid: page,
			json: 1,
			names: allTags.join(" ")
		});
		const url = `https://gelbooru.com/index.php?${params}`;
		const response = await fetch(url);
		return safeParse(await response.text()) || {};
	}
	function isBlank(r: any) {
		return !r["@attributes"];
	}
	function countBlanks(responses: any[]) {
		return responses.filter(isBlank).length;
	}
	if (allTags.length === 0) return [];

	const firstResponse = await phetchTagsPage(0);
	if (isBlank(firstResponse)) return null;

	const pageCount = Math.ceil(firstResponse["@attributes"].count / firstResponse["@attributes"].limit);
	const pageRange: number[] = range(1, pageCount);

	const additionals: any[] = [];
	for (const page of pageRange) {
		additionals.push(await phetchTagsPage(page));
		await sleep(420);
	}

	for (
		let tries = 0;
		tries < 3 && countBlanks(additionals) > 0;
		++tries
	){
		await sleep(3000);
		for (let i = 0; i < additionals.length; ++i){
			if (isBlank(additionals[i])){
				additionals[i] = await phetchTagsPage(i + 1);
			}
		}
	}

	if (countBlanks(additionals) > 0) {
		console.error("failed to fill blanks for tags");
		return null;
	}

	additionals.forEach(pack => firstResponse.tag = firstResponse.tag.concat(pack.tag));
	const artists = firstResponse.tag
		.filter((t: any) => t?.type == 1)
		.map((t: any) => t.name);

	return artists;
}

type ParsedPost = ReturnType<typeof parse>;
function parse(post: any, tags: string[]) {
	return {
		links: [
			post.file_url,
			post.sample_url
		].filter(l => l) as string[],
		id: post.id as number,
		link: `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}`,
		preview: (post.preview_url as string) || null,
		source: post.source?.startsWith("http") ? (post.source as string) : null,
		tags: post.tags.split(" ") as string[],
		rating: post.score as number,
		nsfw: !(post.rating == "general"),
		glbRating: post.rating as string,
		artists: tags.filter(a => post.tags.includes(a))
	};
}
async function gelbooruPosts(
	query: { tags: string } | { id: number },
	token: string,
	user: number,
	page: number,
	tags: string[],
	skipArtists = false,
	batchLimit = 100
): Promise<ParsedPost[]> {
	const params = buildURLParams({
		page: "dapi",
		s: "post",
		q: "index",
		json: 1,
		pid: page,
		api_key: token,
		user_id: user,
		...query,
		limit: batchLimit
	});

	const url = `https://gelbooru.com/index.php?${params}`;
	const response = await fetch(url);
	const payload = safeParse(await response.text()) || {};
	const posts: ParsedPost[] = (payload?.post || []).map((raw: any) => parse(raw, tags));

	const allTags = Array.from(new Set(posts.flatMap(p => p.tags)));

	const allArtists = skipArtists
		? []
		: await filterArtists(allTags, user, token);

	if (!allArtists) return [];
	posts.forEach(p => p.artists = allArtists.filter((a) => p.tags.includes(a)));

	return posts;
}

function postToMessage(post: ParsedPost): Message {
	return {
		version: 4,
		tags: post.tags,
		artists: post.artists,
		nsfw: post.nsfw,
		rating: post.glbRating === "general"
			? "safe"
			: post.glbRating === "sensitive"
				? "suggestive"
				: "explicit",
		content: post.links[0]!,
		preview: post.preview!,
		reference: `${post.id}`,
		grabber: "gelbooru",
		links: [
			button("Gelbooru", post.link),
			post.source && button("Source", post.source),
			...post.artists.map((a) =>
				button(`🎨 ${a}`, `https://gelbooru.com/index.php?page=post&s=list&tags=${a}`)
			)
		].filter(l => l) as TelegramButton[]
	};
}

export const gelbooruGrabber: Grabber<GelbooruConfig> = {
	id: "gelbooru",
	schema: GelbooruConfigSchema,
	grab: async (grabber, options = {}) => {
		const lastSeen = grabber.state.lastSeen || 0;
		const mandatoryFilter = ["sort:id:asc", `id:>${lastSeen}`];

		const tags = grabber.config.tags.join(" ~ ");
		const black = grabber.config.blacks.map(bt => `-${bt}`).join(" ");
		const white = mandatoryFilter.concat(grabber.config.whites).join(" ");
		const tq = grabber.config.tags.length > 1 ? `{${tags}}` : tags;
		const bq = grabber.config.blacks.length > 0 ? `${black} ` : "";
		const query = `${tq} ${bq}${white}`;

		const posts = await gelbooruPosts(
			{ tags: query },
			grabber.credentials.token,
			grabber.credentials.user,
			0,
			grabber.config.tags,
			options.skipArtists,
			options.batchLimit
		);

		const newest = last(posts);
		if (newest) grabber.state.lastSeen = newest.id;

		return posts.map(postToMessage);
	},
	verify: async (config, reference) => {
		const posts = await gelbooruPosts(
			{ id: parseInt(reference, 10) },
			config.credentials.token,
			config.credentials.user,
			0,
			[]
		);
		return posts[0] ? postToMessage(posts[0]) : null;
	}
};
