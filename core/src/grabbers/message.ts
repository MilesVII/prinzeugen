import { t, type Static } from "elysia";
import { Value } from "@sinclair/typebox/value";

export const TelegramButtonSchema = t.Object({
	text: t.String(),
	url: t.String()
});
export type TelegramButton = Static<typeof TelegramButtonSchema>;

/** Telegram pre-uploaded content, referenced by file id */
const MessageV2Schema = t.Object({
	version: t.Literal(2),
	id: t.String(),
	type: t.String(),
	links: t.Array(t.String())
});

/** Direct URLs with an optional cached copy */
const MessageV3Schema = t.Object({
	version: t.Literal(3),
	tags: t.Optional(t.Array(t.String())),
	artists: t.Optional(t.Array(t.String())),
	nsfw: t.Optional(t.Boolean()),
	cached: t.Optional(t.Boolean()),
	notCacheable: t.Optional(t.Boolean()),
	cachedContent: t.Optional(t.Object({
		content: t.String(),
		preview: t.String()
	})),
	content: t.String(),
	preview: t.String(),
	links: t.Array(TelegramButtonSchema)
});

/** Grabber-reliant publishing: content URL captured at grab time plus a reference for re-fetching */
const MessageV4Schema = t.Object({
	version: t.Literal(4),
	tags: t.Optional(t.Array(t.String())),
	artists: t.Optional(t.Array(t.String())),
	nsfw: t.Boolean(),
	rating: t.Optional(t.Union([t.Literal("safe"), t.Literal("suggestive"), t.Literal("explicit")])),
	content: t.String(),
	preview: t.String(),
	reference: t.String(),
	grabber: t.String(),
	links: t.Array(TelegramButtonSchema)
});

export const MessageSchema = t.Union([MessageV2Schema, MessageV3Schema, MessageV4Schema]);

export type MessageV2 = Static<typeof MessageV2Schema>;
export type MessageV3 = Static<typeof MessageV3Schema>;
export type MessageV4 = Static<typeof MessageV4Schema>;
export type Message = Static<typeof MessageSchema>;

/** Returns a list of human-readable problems, empty when the stored message is publishable */
export function validateMessage(message: unknown): string[] {
	if (Value.Check(MessageSchema, message)) return [];
	return [...Value.Errors(MessageSchema, message)].map(e => `${e.path || "/"}: ${e.message}`);
}
