import { validate, ARRAY_OF, OPTIONAL, DYNAMIC, ANY_OF } from "arstotzka";
import postgres from "postgres";

import {
	chunk,
	tg,
	tgReport,
	phetchV2,
	safeParse,
	hashPassword,
	parseTelegramTarget,
	escapeMarkdown
} from "./utils.js";
import { registry as grabbersMeta } from "./grabbers/index.ts";
import { messageSchema, TG_BUTTON_SCHEMA } from "./grabbers/message.js"

const sql = postgres(Bun.env.DB_CONNECTION);

const NINE_MB = 9 * 1024 * 1024;
const PUB_FLAGS = {
	//ALLOW_IMG_ONLY: "imgonly",
	USE_PROXY: "useproxy",
	//NO_SIZE_LIMIT: "nosizelimit",
	KEEP_AFTER_POST: "keep",
	MARKDOWN_LINKS: "markdownlinks",
	DOUBLE_TAP: "doubletap",
	NSFW_ONLY: "nsfw",
	SFW_ONLY: "sfw",
};
const imageProxy = url => `https://prinzeugen.fokses.pro/resize?source=${encodeURIComponent(url)}&randomize=${Math.random()}`;

const authSchema = {
	user: "number",
	userToken: "string",
};
const schema = {
	debug:{},
	login: {
		...authSchema
	},
	saveSettings: {
		...authSchema,
		newUserToken: [OPTIONAL, "string"],
		newTgToken: [OPTIONAL, "string"],
		additionalData: "string"
	},
	setGrabbers: {
		...authSchema,
		grabbers: ARRAY_OF([
			DYNAMIC(x => grabbersMeta[x?.type]?.configSchema)
		])
	},
	getGrabbers: {
		...authSchema,
	},
	grab: {
		...authSchema,
		id: [OPTIONAL, "number"],
		batchSize: [OPTIONAL, "number"]
	},
	getModerables: {
		...authSchema
	},
	getPool: {
		user: "number"
	},
	getPoolPage: {
		user: "number",
		page: "number"
	},
	wipePool: {
		...authSchema
	},
	moderate: {
		...authSchema,
		decisions: ARRAY_OF({
			id: "number",
			approved: "boolean"
		})
	},
	unschedulePost: {
		...authSchema,
		id: ANY_OF(["number", x => !isNaN(parseInt(x))])
	},
	unfailPost: {
		...authSchema,
		id: ANY_OF(["number", x => !isNaN(parseInt(x))])
	},
	manual: {
		...authSchema,
		posts: ARRAY_OF({
			images: ARRAY_OF("string"),
			links: ARRAY_OF(TG_BUTTON_SCHEMA)
		})
	},
	backup: {
		...authSchema,
		//table: x => ["users", "pool"].includes(x)
	},
	publish: {
		user: "number",
		userToken: "string",
		target: "string",
		id: [OPTIONAL, "number"],
		flags: [OPTIONAL, ARRAY_OF(["string", x => Object.values(PUB_FLAGS).includes(x)])],
		count: [OPTIONAL, "number"],
		extras: OPTIONAL
	}
};

function getApproved(user, limit = "all", offset = 0){
	return (sql`
		select *, count(*) over() as total
			from "pool"
			where "user" = ${user} and "approved" = true
			order by "failed" = false, id asc
			limit ${limit}
			offset ${offset}
	`);
}

async function grab(user, id, batchSize){
	function flatten(arr){
		return arr.reduce((p, c) => p.concat(c), []);
	}

	const grabbers = await getGrabbers(user);
	if (grabbers === null) return null;
	if (grabbers?.length == 0) return [];

	let selection = grabbers;
	if (id !== undefined){
		if (id >= 0 && id < grabbers.length)
			selection = [grabbers[id]];
		else
			return null;
	}

	const options = {
		batchSize: batchSize
	};

	const moderated = [];
	const approved = [];
	for (const grabber of selection){
		const prom = grabbersMeta[grabber.type].grab(grabber, options);

		if (grabber.config.moderated) 
			moderated.push(prom);
		else
			approved.push(prom);
	}

	const newEntries = [
		...flatten(await Promise.all(moderated)).map(message => ({
			message: message,
			user: user,
			failed: false,
			approved: null
		})),
		...flatten(await Promise.all(approved)).map(message => ({
			message: message,
			user: user,
			failed: false,
			approved: true
		}))
	];

	const grabbersColumn = {
		grabbers: grabbers
	};
	if (newEntries.length > 0){
		await sql.begin(async sql => {
			await sql`insert into pool ${sql(newEntries)}`;
			await sql`update users set ${sql(grabbersColumn)} where "id" = ${user}`;
		});
	}
	return newEntries.length;
}

async function getGrabbers(user){
	const response = await sql`select "grabbers" from "users" where "id" = ${user}`;
	if (response[0]?.grabbers)
		return response[0].grabbers || [];
	else
		return null;
}

function setGrabbers(user, grabbers){
	const grabbersColumn = {
		grabbers: grabbers
	};
	return (sql`
		update users
			set ${sql(grabbersColumn)}
			where "id" = ${user}
			returning "grabbers"
	`);
}

function getModerables(user, limit = 200){
	return sql`select * from pool where "user" = ${user} and "approved" is null limit ${limit}`;
}

async function getStats(user){
	const response = await sql`
		select
			sum (case when ("user" = ${user} and "approved" = true) then 1 else 0 end) as approved,
			sum (case when ("user" = ${user} and "failed" = true) then 1 else 0 end) as failed,
			sum (case when ("user" = ${user} and "approved" is NULL) then 1 else 0 end) as pending
		from
			pool
	`;
	return response[0];
}

async function userAccessAllowed(id, token){
	const user = await sql`select "access_token" from users where id = ${id}`;
	return !!(user && user[0] && (user[0]["access_token"] === token || user[0]["access_token"] === null));
}

async function pingContentUrl(url){
	const meta = await phetchV2(url, {method: "HEAD"});
	if (meta.status != 200) return null;

	const typeRaw = meta.headers["content-type"] || "image/dunno";
	let type;
	if (typeRaw.startsWith("image/") && typeRaw != "image/gif")
		type = "img";
	else if (typeRaw == "image/gif")
		type = "gif";
	else
		type = "vid";
	
	return {
		length: parseInt(meta.headers["content-length"] || "0", 10),
		type: type
	}
}

function linksToMarkdown(links){
	return links
		.map(button => `[${escapeMarkdown(button.text)}](${escapeMarkdown(button.url)})`)
		.join(" ");
}

function linksToMarkup(links){
	return {
		inline_keyboard: chunk(links, 2)
	};
}

//return null on success or any object on error
async function publish2Telegram(message, token, target, extras = {}, flags){
	const validationErrors = validate(message, messageSchema[message.version]);
	if (validationErrors.length > 0){
		return validationErrors;
	}

	function metaSand(type, content, links){
		const useMarkdownLinks = flags.includes(PUB_FLAGS.MARKDOWN_LINKS) || extras.customMarkup;

		const messageData = {
			chat_id: target
		};

		if (useMarkdownLinks){
			messageData.caption = linksToMarkdown(links);
			messageData.parse_mode = "MarkdownV2"
		} else {
			messageData.reply_markup = linksToMarkup(links)
		}

		if (extras.customMarkup){
			messageData.reply_markup = extras.customMarkup
		}

		if (extras.extraLink){
			let appendix = null;
			if (typeof extras.extraLink == "string"){
				appendix = {
					text: "More",
					url: extras.extraLink
				};
			} else if (extras.extraLink.text && extras.extraLink.url){
				appendix = extras.extraLink;
			}

			if (appendix){
				if (useMarkdownLinks){
					const md = linksToMarkdown([appendix]);
					messageData.caption += `\n${md}`;
				} else {
					links.push(appendix);
					messageData.reply_markup = linksToMarkup(links);
				}
			}
		}

		let command;
		switch (type.trim().toLowerCase()){
			case ("img"): {
				messageData.photo = content;
				command = "sendPhoto";
				break;
			}
			case ("gif"): {
				messageData.animation = content;
				command = "sendAnimation";
				break;
			}
			case ("vid"): {
				messageData.video = content;
				command = "sendVideo";
				break;
			}
			case ("doc"): {
				messageData.document = content;
				command = "sendDocument";
				break;
			}
			default: return "Can't detect content type to send to Tg"
		}
		return tg(command, messageData, token);
	}

	if (message.version === 2) {
		const report = await metaSand(message.type, message.id, message.links);
		if (safeParse(report)?.ok) return null;
		return report;
	}
	if (message.version === 3) {
		if (message.content.startsWith("https://img4"))
			message.content = message.content.split("//img4").join("//img2");
		const meta = await pingContentUrl(message.content);
		if (!meta) return "No head?";
		
		const report = {};

		report.direct = await metaSand(meta.type, message.content, message.links);
		if (safeParse(report.direct)?.ok) return null;

		if (message.cached){
			report.fromCache = await metaSand(meta.type, imageProxy(message.cachedContent.content), message.links);
			if (safeParse(report.fromCache)?.ok) return null;
		}
		if (meta.type == "img") {
			report.proxy = await metaSand(meta.type, imageProxy(message.content), message.links);
			if (safeParse(report.proxy)?.ok) return null;
		}
		return report;
	}
	if (message.version === 4) {
		// version 4 is grabber-reliant posting, but retrieving the grabber credentials
		// is troublesome since it should be linked to the user directly, not the
		// grabber config
		if (message.content.startsWith("https://img4"))
			message.content = message.content.split("//img4").join("//img2");

		const meta = await pingContentUrl(message.content);
		if (!meta) return "No head?";

		const report = {};

		report.direct = await metaSand(meta.type, message.content, message.links);
		if (safeParse(report.direct)?.ok) return null;

		report.proxy = await metaSand(
			meta.type == "img" ? "img" : "vid",
			imageProxy(message.content),
			message.links
		);
		if (safeParse(report.proxy)?.ok) return null;

		return report;
	}
	
	return "WTF is that message version, how did you pass validation";
}

export default async function handler(request) {
	if (!request)
		return [400, "Malformed request. Content-Type header and POST required."];
	if (!schema[request.action])
		return [400, `Unknown action: ${request?.action}\nRqBody: ${JSON.stringify(request)}`];

	const validationErrors = validate(request, schema[request.action]);
	if (validationErrors.length > 0)
		return [400, validationErrors];

	if (request.userToken) request.userToken = hashPassword(request.userToken);

	const PUBLIC_ACTIONS = ["debug", "login"];

	if (!(
		PUBLIC_ACTIONS.includes(request.action) ||
		await userAccessAllowed(request.user, request.userToken)
	))
		return [401, "Wrong user id or access token"];

	switch (request.action){
		case ("debug"): {
			return [200]
		}
		case ("login"): {
			const userData = await sql`select * from users where id = ${request.user}`;
			if (userData?.length > 0 && (userData[0]["access_token"] == request.userToken || userData[0]["access_token"] == null)){
				userData[0]["access_token"] = null;

				const [moderables, stats] = await Promise.all([
					getModerables(request.user),
					getStats(request.user)
				]);
				userData[0].moderables = moderables;
				userData[0].stats = stats;
				return [200, userData[0]]
			} else {
				return [401]
			}
		}
		case ("saveSettings"): {
			const delta = {
				additional: request.additionalData
			};
			if (request.newUserToken) delta.access_token = hashPassword(request.newUserToken);
			if (request.newTgToken) delta.tg_token = request.newTgToken;
			
			await sql`update users set ${sql(delta)} where id = ${request.user}`;
			return [200];
		}
		case ("getGrabbers"): {
			const grabs = await getGrabbers(request.user);
			return (grabs
				? [200, grabs]
				: [401, "Wrong user id or access token"]
			);
		}
		case ("grab"): {
			const newCount = await grab(request.user, request.id, request.batchSize);
			return [200, `${newCount}`];
		}
		case ("setGrabbers"): {
			const success = await setGrabbers(request.user, request.grabbers);
			return [success ? 200 : 401];
		}
		case ("getModerables"): {
			const messages = await getModerables(request.user);
			return [200, messages];
		}
		case ("getPool"): {
			const rows = await getApproved(request.user);
			return [200, rows]
		}
		case ("getPoolPage"): {
			const stride = request.stride || 100;
			const page = request.page;
			const rows = await getApproved(request.user, stride, page * stride);
			return [200, rows]
		}
		case ("wipePool"): {
			const re = sql`delete from "pool" where "user" = ${request.user}`
			return [200]
		}
		case ("moderate"): {
			const decisionSchema = {
				id: "number",
				approved: "boolean"
			};
			const decisions = request.decisions
				.filter(d => validate(d, decisionSchema).length == 0)
				.map(({id, approved}) => [id, approved]);
			
			await sql`
				update "pool"
					set id = (update_data.id)::bigint, approved = (update_data.approved)::boolean
					from (values ${sql(decisions)}) as update_data(id, approved)
					where pool.id = (update_data.id)::bigint
			`;
			await sql `delete from "pool" where "approved" = false`;
			const newModerables = await sql`
				select *
					from "pool"
					where "user" = ${request.user} and "approved" is null
					limit 200
			`;

			return [200, newModerables]
		}
		case ("unschedulePost"): {
			await sql`
				delete
					from "pool"
					where "user" = ${request.user} and "id" = ${request.id}
			`;
			return [200];
		}
		case ("unfailPost"): {
			const entry = {
				id: request.id,
				failed: false
			}
			await sql`
				update "pool"
					set ${sql(entry, "failed")}
					where "id" = ${request.id}
			`;
			return [200];
		}
		case ("backup"): {
			return [400];
		}
		case ("publish"): {
			const flags = request.flags?.map(f => f.trim().toLowerCase()) || [];

			const target = parseTelegramTarget(request.target);
			if (!target && !flags.includes(PUB_FLAGS.URL_AS_TARGET))
				return [400, "Can't parse telegram target"]
			const count = request.count || 1;
			const ratingFilter = flags.includes(PUB_FLAGS.SFW_ONLY)
				? "sfw"
				: flags.includes(PUB_FLAGS.NSFW_ONLY)
					? "nsfw"
					: null;

			let availablePosts = await sql`
				select pool.*, users.tg_token
					from pool inner join users on pool."user" = users."id"
					where
						pool."user" = ${request.user}
						and not exists (
							select 1
							from published_logs l
							where l.post_id = pool.id
								and l.target = ${String(target)}
						)
						and pool."approved" = true
						${request.id
							? sql`and pool."id" = ${request.id}`
							: sql`and pool."failed" = false`
						}
						${ratingFilter !== null
							? ratingFilter === "nsfw"
								? sql`
									and (pool."message"->>'version')::int = 4
									and (pool."message"->>'rating') = 'explicit'
								`
								: sql`
									and (pool."message"->>'version')::int = 4
									and (pool."message"->>'nsfw')::boolean = false
								`
							: sql``
						}
					order by random()
					limit ${count * 2}
			`;

			if (availablePosts.length == 0)
				return [404, "No scheduled posts for this user"];

			let doubleTapFuze = true;
			for (let tasksLeft = count; tasksLeft > 0; --tasksLeft){
				if (availablePosts.length === 0) break;
				const post = availablePosts.pop();
				const error = await publish2Telegram(post.message, post.tg_token, target, request.extras, flags);

				if (error){
					if (flags.includes(PUB_FLAGS.DOUBLE_TAP) && availablePosts.length > 0 && doubleTapFuze){
						++tasksLeft;
						doubleTapFuze = false;
					}
					await Promise.allSettled([
						tgReport(`Failed to publish post #${post.id}.\nResponse:\n${JSON.stringify(error, null, "\t")}`),
						sql`update pool set ${sql({failed: true})} where id = ${post.id}`
					]);
				} else {
					if (flags.includes(PUB_FLAGS.KEEP_AFTER_POST)) {
						await sql`insert into published_logs ${sql({
							post_id: post.id,
							target: String(target)
						})}`;
					} else {
						await sql`delete from published_logs where post_id = ${post.id}`;
						await sql`delete from pool where id = ${post.id}`;
					}
				}
			}

			return [200];
		}
		default: {
			return [400, "Malformed request"]
		}
	}
}
