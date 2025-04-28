import { fetch } from "bun";
import { last, safeParse, range, sleep } from "../utils.js";
import type { GelbooruGrabber } from "./index.js";
import type { Message, TelegramButton } from "./message.js";

function button(text: string, url: string): TelegramButton {
	return { text: text, url: url };
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
		return !r["@attributes"]
	}
	function countBlanks(responses: any) {
		return responses.filter(isBlank).length;
	}

	let firstResponse = await phetchTagsPage(0);
	if (isBlank(firstResponse)) return null;
	
	const pageCount = Math.ceil(firstResponse["@attributes"].count / firstResponse["@attributes"].limit)
	const pageRange: number[] = range(1, pageCount);

	const additionals = await Promise.all(pageRange.map(page => phetchTagsPage(page)));
	for (
		let tries = 0;
		tries < 3 && countBlanks(additionals) > 0;
		++tries
	){
		await sleep(3000);
		for (let i in additionals){
			if (isBlank(additionals[i])){
				const p = parseInt(i, 10) + 1;
				additionals[i] = await phetchTagsPage(p);
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
		nsfw: !(post.rating == "general" || post.rating == "sensitive"),
		artists: tags.filter(a => post.tags.includes(a))
	}
}
async function gelbooruPosts(
	query: { tags: string } | { id: number },
	token: string,
	user: number,
	page: number,
	tags: string[]
): Promise<ParsedPost[]> {
	const params = buildURLParams({
		page: "dapi",
		s: "post",
		q: "index",
		json: 1,
		pid: page,
		api_key: token,
		user_id: user,
		...query
	});

	const url = `https://gelbooru.com/index.php?${params}`;
	const response = await fetch(url);
	const payload = safeParse(await response.text()) || {};
	return (payload?.post || []).map((raw: any) => parse(raw, tags));
}

function postToMessage(post: ParsedPost): Message {
	return {
		version: 4,
		tags: post.tags,
		artists: post.artists,
		nsfw: post.nsfw,
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

export const gelbooruGrabber: GelbooruGrabber = {
	id: "gelbooru",
	configSchema: {
		credentials: {
			user: "number",
			token: "string"
		},
		config: {
			tags: "array",
			whites: "array",
			blacks: "array",
			moderated: "boolean"
		},
		state: {
			lastSeen: "number"
		}
	},
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
			grabber.config.tags
		);

		const allTags = Array.from(
			new Set(posts
				.map(p => p.tags)
				.reduce((p: string[], c) => p.concat(c), [])
			).values()
		);

		if (posts.length > 0){
			const allArtists = options.skipArtists ? [] : await filterArtists(allTags, grabber.credentials.user, grabber.credentials.token);
			if (allArtists)
				posts.forEach((p: any) => p.artists = allArtists.filter((a) => p.tags.includes(a)));
			else
				return [];
		}

		if (posts.length > 0) grabber.state.lastSeen = last(posts).id;

		return posts.map(postToMessage);
	},
	verify: async (config, reference) => {
		const params = buildURLParams({
			page: "dapi",
			s: "post",
			q: "index",
			id: reference,
			pid: 0,
			json: 1,
			api_key: config.credentials.token,
			user_id: config.credentials.user
		});
		const url = `https://gelbooru.com/index.php?${params}`;
		
		const posts = await gelbooruPosts(
			{ id: parseInt(reference, 10) },
			config.credentials.token,
			config.credentials.user,
			0,
			[]
		);
		if (posts[0])
			return postToMessage(posts[0]);
		else
			return null;
	}
}
