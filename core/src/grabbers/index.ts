import { t, type Static, type TSchema } from "elysia";
import type { Message } from "./message.ts";
import { gelbooruGrabber, GelbooruConfigSchema } from "./gelbooru.ts";

export type GrabOptions = {
	skipArtists?: boolean,
	batchLimit?: number
};

export type Grabber<Config> = {
	id: Config extends { type: infer Id } ? Id : string,
	schema: TSchema,
	grab: (config: Config, options?: GrabOptions) => Promise<Message[]>,
	verify: (config: Config, reference: string) => Promise<null | Message>
};

/** Union of every grabber config; `type` discriminates */
export const GrabberConfigSchema = t.Union([GelbooruConfigSchema]);
export type GrabberConfig = Static<typeof GrabberConfigSchema>;

export const registry: { [K in GrabberConfig["type"]]: Grabber<Extract<GrabberConfig, { type: K }>> } = {
	gelbooru: gelbooruGrabber
};
