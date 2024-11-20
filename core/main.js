import { chunk, safe, tg, tgReport, phetch, phetchV2, safeParse, hashPassword, parseTelegramTarget, wegood, escapeMarkdown, processImage } from "./utils.js";
import { grabbersMeta } from "./grabbers.js";
import { validate, ARRAY_OF, OPTIONAL, DYNAMIC, ANY_OF } from "arstotzka"; 
import { config } from "./configProvider.js";
import postgres from "postgres";

const sql = postgres(config.sql.connections.kriegsspiel);

const NINE_MB = 9 * 1024 * 1024;
const PUB_FLAGS = {
	//ALLOW_IMG_ONLY: "imgonly",
	USE_PROXY: "useproxy",
	//NO_SIZE_LIMIT: "nosizelimit",
	KEEP_AFTER_POST: "keep",
	MARKDOWN_LINKS: "markdownlinks",
	DOUBLE_TAP: "doubletap"
};
const imageProxy = url => `https://prinzeugen.fokses.pro/imageproxy?url=${url}&randomize=${Math.random()}`;

const TG_BUTTON_SCHEMA = {
	text: "string",
	url: "string"
};

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
			DYNAMIC(x => grabbersMeta[x?.type]?.schema),
			{
				type: "string"
			}
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

const messageSchema = [
	{//0, deprecated version, publisher depends on it's 'raw' property to convert to newer version
		version: ["number", x => x == 0],
		attachments: "array",
		caption: "string"
	},
	{//1
		version: ["number", x => x == 1],
		image: ARRAY_OF("string"),
		links: ARRAY_OF(TG_BUTTON_SCHEMA)
	},
	{//2, telegram preuploaded
		version: ["number", x => x == 2],
		id: "string",
		type: "string",
		links: "array"
	},
	{//3, no raw
		version: ["number", x => x == 3],
		raw: [OPTIONAL, x => false],
		tags: [OPTIONAL, ARRAY_OF("string")],
		artists: [OPTIONAL, ARRAY_OF("string")],
		nsfw: [OPTIONAL, "boolean"],
		cached: [OPTIONAL, "boolean"],
		notCacheable: [OPTIONAL, "boolean"],
		cachedContent: [OPTIONAL, {
			content: "string",
			preview: "string",
		}],
		content: "string",
		preview: "string",
		links: ARRAY_OF(TG_BUTTON_SCHEMA)
	}
];

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
		skipArtists: user == 3,
		batchSize: batchSize
	};

	const moderated = [];
	const approved = [];
	for (const grabber of selection){
		const prom = grabbersMeta[grabber.type].action(grabber, options);

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

	if (message.version == 0){
		message.version = 1;
		
		const imageVariants = message.attachments[0]
			.slice(0, 2)
			.filter(l => l.length > 0);

		message.image = imageVariants;

		if (!message.raw.source?.startsWith("http")) message.raw.source = null;
		message.links = [
			{text: "Gelbooru", url: message.raw.link},
			{text: "Source", url: message.raw.source || null},
		].filter(i => i.url).concat(message.raw.artists.map(a => ({
			text: `🎨 ${a}`,
			url: `https://gelbooru.com/index.php?page=post&s=list&tags=${a}`
		})));
	}
	if (message.version == 1){
		if (message.image.length > 0){
			const meta = await pingContentUrl(message.image[0]);
			if (!meta) return "No head?";
			let usingProxy = flags.includes(PUB_FLAGS.USE_PROXY);

			let content = message.image[0];
			if (meta.type == "img" && usingProxy) content = imageProxy(content);
			if (meta.type == "img" && !usingProxy && meta.length > NINE_MB){
				if (message.image[1]){
					content = message.image[1];
				} else {
					content = imageProxy(content);
					usingProxy = true;
				}
			}

			const report = {};

			report.tg = await metaSand(meta.type, content, message.links);
			if (safeParse(report.tg)?.ok) return null;

			if (meta.type != "img" || usingProxy)
				return report;
			content = imageProxy(content);
			report.retry = await metaSand(meta.type, content, message.links);
			if (safeParse(report.retry)?.ok) 
				return null;
			else
				return report;
		} else {
			return "No attachments";
		}
	}
	if (message.version == 2){
		const report = await metaSand(message.type, message.id, message.links);
		if (safeParse(report)?.ok) return null;
		return report;
	}
	if (message.version == 3){
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
	
	return "WTF is that message version, how did you pass validation";
}

export default async function handler(request, response) {
	if (request.method != "POST" || !request.body){
		response.status(400).send("Malformed request. Content-Type header and POST required.");
		return;
	}
	if (!schema[request.body?.action]){
		response.status(400).send(`Unknown action: ${request.body?.action}\nRqBody: ${JSON.stringify(request.body)}`);
		return;
	}
	const validationErrors = validate(request.body, schema[request.body.action]);
	if (validationErrors.length > 0){
		response.status(400).send(validationErrors);
		return;
	}
	if (request.body.userToken) request.body.userToken = hashPassword(request.body.userToken);

	const PUBLIC_ACTIONS = ["debug", "login"];

	if (!PUBLIC_ACTIONS.includes(request.body.action)){
		if (!await userAccessAllowed(request.body.user, request.body.userToken)){
			response.status(401).send("Wrong user id or access token");
			return;
		}
	}

	switch (request.body.action){
		case ("debug"): {
			response.status(200).send();
			return;
		}
		case ("login"): {
			const userData = await sql`select * from users where id = ${request.body.user}`;
			if (userData?.length > 0 && (userData[0]["access_token"] == request.body.userToken || userData[0]["access_token"] == null)){
				userData[0]["access_token"] = null;

				const [moderables, stats] = await Promise.all([
					getModerables(request.body.user),
					getStats(request.body.user)
				]);
				userData[0].moderables = moderables;
				userData[0].stats = stats;
				response.status(200).send(userData[0]);
			} else {
				response.status(401).send();
			}
			return;
		}
		case ("saveSettings"): {
			const delta = {
				additional: request.body.additionalData
			};
			if (request.body.newUserToken) delta.access_token = hashPassword(request.body.newUserToken);
			if (request.body.newTgToken) delta.tg_token = request.body.newTgToken;
			
			await sql`update users set ${sql(delta)} where id = ${request.body.user}`;
			response.status(200).send();
			return;
		}
		case ("getGrabbers"): {
			const grabs = await getGrabbers(request.body.user);
			if (grabs)
				response.status(200).send(grabs);
			else
				response.status(401).send("Wrong user id or access token");
			return;
		}
		case ("grab"): {
			const newCount = await grab(request.body.user, request.body.id, request.body.batchSize);
			response.status(200).send(`${newCount}`);
			return;
		}
		case ("setGrabbers"): {
			const success = await setGrabbers(request.body.user, request.body.grabbers);
			response.status(success ? 200 : 401).send();
			return;
		}
		case ("getModerables"): {
			const messages = await getModerables(request.body.user);
			response.status(200).send(messages);
			return;
		}
		case ("getPool"): {
			const rows = await getApproved(request.body.user);
			response.status(200).send(rows);
			return;
		}
		case ("getPoolPage"): {
			const stride = request.body.stride || 100;
			const page = request.body.page;
			const rows = await getApproved(request.body.user, stride, page * stride);
			response.status(200).send(rows);
			return;
		}
		case ("wipePool"): {
			const re = sql`delete from "pool" where "user" = ${request.body.user}`
			response.status(200).send();
			return;
		}
		case ("moderate"): {
			const decisionSchema = {
				id: "number",
				approved: "boolean"
			};
			const decisions = request.body.decisions
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
					where "user" = ${request.body.user} and "approved" is null
					limit 200
			`;

			response.status(200).send(newModerables);
			return;
		}
		case ("unschedulePost"): {
			await sql`
				delete
					from "pool"
					where "user" = ${request.body.user} and "id" = ${request.body.id}
			`;
			response.status(200).send();
			return;
		}
		case ("unfailPost"): {
			const entry = {
				id: request.body.id,
				failed: false
			}
			await sql`
				update "pool"
					set ${sql(entry, "failed")}
					where "id" = ${request.body.id}
			`;
			response.status(200).send();
			return;
		}
		case ("backup"): {
			const users = await sql`select * from users`;
			const pool = await sql`select * from pool`;
			//console.log(await tgReport(table));
			response.status(200).send({users, pool});
			return;
		}
		case ("publish"): {
			const flags = request.body.flags?.map(f => f.trim().toLowerCase()) || [];

			const target = parseTelegramTarget(request.body.target);
			if (!target && !flags.includes(PUB_FLAGS.URL_AS_TARGET)){
				response.status(400).send("Can't parse telegram target");
				return;
			}
			const count = request.body.count || 1;

			let availablePosts = await sql`
				select pool.*, users.tg_token
					from pool inner join users on pool."user" = users."id"
					where
						pool."user" = ${request.body.user}
						and pool."approved" = true
						${request.body.id
							? sql`and pool."id" = ${request.body.id}`
							: sql`and pool."failed" = false`
						}
					order by random()
					limit ${count * 2}
			`;

			if (availablePosts.length == 0){
				response.status(404).send("No scheduled posts for this user");
				return;
			}

			let doubleTapFuze = true;
			for (let tasksLeft = count; tasksLeft > 0; --tasksLeft){
				if (availablePosts.length === 0) break;
				const post = availablePosts.pop();
				const error = await publish2Telegram(post.message, post.tg_token, target, request.body.extras, flags);

				if (error){
					if (flags.includes(PUB_FLAGS.DOUBLE_TAP) && availablePosts.length > 0 && doubleTapFuze){
						++tasksLeft;
						doubleTapFuze = false;
					}
					await Promise.allSettled([
						tgReport(`Failed to publish post #${post.id}.\nResponse:\n${JSON.stringify(error)}`),
						sql`update pool set ${sql({failed: true})} where id = ${post.id}`
					]);
				} else {
					if (!flags.includes(PUB_FLAGS.KEEP_AFTER_POST)){
						await sql`delete from pool where id = ${post.id}`;
					}
				}
			}

			response.status(200).send();
			return;
		}
		default: {
			response.status(400).send("Malformed request");
			return;
		}
	}
}
