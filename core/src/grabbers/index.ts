import type { Message } from "./message";

import { gelbooruGrabber } from "./gelbooru"

const grabbers = [ gelbooruGrabber ];
export const registry = Object.fromEntries(grabbers.map(g => [g.id, g]))

export type Grabber<Id extends string, Config, Options> = {
	id: Id,
	configSchema: any,
	grab: (config: Config, options?: Options) => Promise<Message[]>,
	verify: (config: Config, reference: string) => Promise<null | Message>
}

type GelbooruConfig = {
	credentials: {
		user: number,
		token: string
	},
	config: {
		tags: string[],
		whites: string[],
		blacks: string[],
	},
	state: {
		lastSeen: number
	}
};
type GelbooruOptions = {
	skipArtists?: boolean
}

export type GelbooruGrabber = Grabber<"gelbooru", GelbooruConfig, GelbooruOptions>
