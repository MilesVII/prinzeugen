import { last, phetch, safeParse, unique, range, sleep } from "./utils.js";

function button(text, url){
	return {text: text, url: url};
}

function buildURLParams(params){
	return Object.keys(params)
		.map(k => `${k}=${encodeURIComponent(params[k])}`)
		.join("&");
}

async function glbFilterArtists(allTags, u, t){
	async function phetchTagsPage(page){
		const params = {
			api_key: t,
			user_id: u,
			page: "dapi",
			s: "tag",
			q: "index",
			pid: page,
			json: 1,
			names: allTags.join(" ")
		};
		const url = `https://gelbooru.com/index.php?${buildURLParams(params)}`;
		return safeParse(await phetch(url)) || {};
	}

	let firstResponse = await phetchTagsPage(0);
	if (!firstResponse["@attributes"]) return null;
	
	const pageCount = Math.ceil(firstResponse["@attributes"].count / firstResponse["@attributes"].limit)
	const pageRange = range(1, pageCount);

	function isBlank(r){
		return !r["@attributes"]
	}
	function countBlanks(responses){
		return responses.filter(entry => isBlank(entry)).length;
	}
	function logResponsesStatus(responses){
		console.log(responses.map(r => isBlank(r) ? "_" : "+").join(""));
	}

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
	const artists = firstResponse.tag.filter(t => t?.type == 1).map(t => t.name);

	return artists;
}

async function twtGetUserIdByName(token, username){
	const response = await phetch(`https://api.twitter.com/2/users/by/username/${username}`, {
		method: "GET",
		headers: {
			"Authorization": `Bearer ${token}`
		}
	}, null);
	return safeParse(response)?.data?.id || null;
}

async function twtGetTweets(token, userId, offset, pagination){
	const EMPTY_RESULT = {tweets: []};
	//Reading tweets is not free anymore
	return EMPTY_RESULT;

	const paginationParameter = pagination ? `pagination_token=${pagination}&` : "";
	const url = `https://api.twitter.com/2/users/${userId}/tweets?${paginationParameter}${[
		"exclude=retweets,replies",
		"expansions=author_id,attachments.media_keys",
		"media.fields=preview_image_url,type,url",
		"user.fields=username",
		"max_results=100",
		`since_id=${offset}`
	].join("&")}`;

	const response = safeParse(await phetch(url, {
		method: "GET",
		headers: {
			"Authorization": `Bearer ${token}`
		}
	}, null));

	if (!response) return EMPTY_RESULT;

	if (response.meta.newest_id == response.meta.oldest_id) return EMPTY_RESULT;

	const additionalBatch = response.meta.next_token ? (await twtGetTweets(token, userId, offset, response.meta.next_token)).tweets : [];

	const imagesRaw = (response?.includes?.media || []).filter(m => m.type == "photo");
	const usersRaw = (response?.includes?.users || []);
	const tweetsRaw = (response?.data || []);

	function tweetByMedia(mediaKey){
		return tweetsRaw.find(tweet => tweet.attachments?.media_keys?.includes(mediaKey));
	}
	function usernameByTweet(tweet){
		return usersRaw.find(u => u?.id == tweet?.author_id)?.username;
	}
	function usernameByMedia(mediaKey){
		const tweet = tweetByMedia(mediaKey);
		return usernameByTweet(tweet);
	}
	function tweetLinkByMedia(mediaKey){
		const tweet = tweetByMedia(mediaKey);
		const username = usernameByTweet(tweet);
		if (tweet?.id && username)
			return `https://twitter.com/${username}/status/${tweet.id}`;
		else
			return null;
	}
	function userLinkByMedia(mediaKey){
		const username = usernameByMedia(mediaKey);
		if (username)
			return `https://twitter.com/${username}`;
		else
			return null;
	}

	return {
		lastId: response?.meta?.newest_id,
		tweets: imagesRaw.map(raw => {
			const artistName = `@${usernameByMedia(raw.media_key)}`;
			
			return {
				version: 3,
				content: raw.url,
				preview: raw.preview_image_url || `${raw.url}?format=jpg&name=small`,
				artists: [artistName],
				links: [
					button("Twitter", tweetLinkByMedia(raw.media_key)),
					button(`🎨 ${artistName}`, userLinkByMedia(raw.media_key))
				].filter(l => l.url),
				cached: false
			}
		}).concat(additionalBatch)
	};
}

async function twtGetMessage(token, tweetId){
	//not implemented
	const url = `https://api.twitter.com/2/tweets/${tweetId}${[
		"expansions=author_id,attachments.media_keys",
		"media.fields=preview_image_url,type,url",
		"user.fields=username"
	].join("&")}`;
	const response = safeParse(await phetch(url, {
		method: "GET",
		headers: {
			"Authorization": `Bearer ${token}`
		}
	}));
	console.log(response)
}

export const manualGrabbers = {
	"twitter": async (postId, token) => {
		return null;
	},
	"gelbooru": async (postId, user, key) => {
		return null;
		const params = buildURLParams({
			page: "dapi",
			s: "post",
			q: "index",
			tags: `id:${postId}`,
			pid: 0,
			json: 1,
			api_key: key,
			user_id: user
		});
		const url = `https://gelbooru.com/index.php?${params}`;
	}
}

export const grabbersMeta = {
	"twitter": {
		schema: {
			credentials: {
				token: "string"
			},
			config: {
				username: "string",
				moderated: "boolean"
			},
			state: {
				lastSeen: "string"
			}
		},
		action: async grabber => {
			if (!grabber.config.userId){
				grabber.config.userId = await twtGetUserIdByName(grabber.credentials.token, grabber.config.username);
			}
			const messages = await twtGetTweets(grabber.credentials.token, grabber.config.userId, grabber.state.lastSeen || 0) || [];
			if (messages.lastId) grabber.state.lastSeen = messages.lastId;

			return messages.tweets;
		}
	},
	"gelbooru": {
		schema: {
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
		action: async (grabber, options = {}) => {
			const lastSeen = grabber.state.lastSeen || 0;
			const mandatoryFilter = ["sort:id:asc", `id:>${lastSeen}`];

			const tags = grabber.config.tags.join(" ~ ");
			const black = grabber.config.blacks.map(bt => `-${bt}`).join(" ");
			const white = mandatoryFilter.concat(grabber.config.whites).join(" ");
			const tq = grabber.config.tags.length > 1 ? `{${tags}}` : tags;
			const bq = grabber.config.blacks.length > 0 ? `${black} ` : "";
			const query = `${tq} ${bq}${white}`;

			const params = buildURLParams({
				page: "dapi",
				s: "post",
				q: "index",
				tags: query,
				pid: 0,
				json: 1,
				...(options.batchSize ? {limit: options.batchSize} : {}),
				api_key: grabber.credentials.token,
				user_id: grabber.credentials.user
			});
			const url = `https://gelbooru.com/index.php?${params}`;

			const response = safeParse(await phetch(url)) || {};
			const posts = (response?.post || []).map(raw => ({
				links: [
					raw.file_url,
					raw.sample_url
				].filter(l => l && l != ""),
				id: raw.id,
				link: `https://gelbooru.com/index.php?page=post&s=view&id=${raw.id}`,
				preview: raw.preview_url || null,
				source: raw.source?.startsWith("http") ? raw.source : null,
				tags: raw.tags.split(" "),
				rating: raw.score,
				nsfw: !(raw.rating == "general" || raw.rating == "sensitive"),
				artists: grabber.config.tags.filter(a => raw.tags.includes(a))
			}));

			const allTags = unique(posts.map(p => p.tags).reduce((p, c) => p.concat(c), []));
			if (posts.length > 0){
				const allArtists = options.skipArtists ? [] : await glbFilterArtists(allTags, grabber.credentials.user, grabber.credentials.token);
				if (allArtists)
					posts.forEach(p => p.artists = allArtists.filter(a => p.tags.includes(a)));
				else
					return [];
			}

			if (posts.length > 0) grabber.state.lastSeen = last(posts).id;

			const messages = posts.map(p => ({
				version: 3,
				tags: p.tags,
				artists: p.artists,
				cached: false,
				content: p.links[0],
				preview: p.preview,
				links: [
						button("Gelbooru", p.link),
						button("Source", p.source)
					].filter(l => l.url).concat(
						p.artists.map(a => button(`🎨 ${a}`, `https://gelbooru.com/index.php?page=post&s=list&tags=${a}`))
					)
			}));

			return messages;
		}
	}
}
