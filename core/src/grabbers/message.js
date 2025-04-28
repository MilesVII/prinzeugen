import { ARRAY_OF, OPTIONAL } from "arstotzka"; 

export const TG_BUTTON_SCHEMA = {
	text: "string",
	url: "string"
};

export const messageSchema = [
	{ // 2, telegram preuploaded
		version: ["number", x => x == 2],
		id: "string",
		type: "string",
		links: "array"
	},
	{ // 3, no raw
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
	},
	{ // 4, grabber-reliant publishing
		version: ["number", x => x == 4],
		tags: [OPTIONAL, ARRAY_OF("string")],
		artists: [OPTIONAL, ARRAY_OF("string")],
		nsfw: "boolean",
		content: "string",
		preview: "string",
		reference: "string",
		grabber: "string",
		links: ARRAY_OF(TG_BUTTON_SCHEMA)
	}
];
