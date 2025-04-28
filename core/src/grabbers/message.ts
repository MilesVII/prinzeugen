
export type TelegramButton = {
	text: string,
	url: string
}

type MessageV2 = {
	version: 2,
	id: string,
	type: string,
	links: string[]
};
type MessageV3 = {
	version: 3,
	tags?: string[],
	artists?: string[],
	nsfw?: boolean,
	cached?: boolean,
	notCacheable?: boolean,
	cachedContent?: {
		content: string,
		preview: string
	},
	content: string,
	preview: string,
	links: TelegramButton[]
};
type MessageV4 = {
	version: 4,
	tags?: string[],
	artists?: string[],
	nsfw: boolean,
	content: string, // At the moment of grabbing
	preview: string,
	reference: string,
	grabber: string,
	links: TelegramButton[]
};

export type Message = MessageV2 | MessageV3 | MessageV4;
