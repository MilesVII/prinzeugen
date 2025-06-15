import postgres from "postgres";

import {
	sleep
} from "./utils.js";
import { registry as grabbersMeta } from "./grabbers/index.ts";




const user = 1;
const sql = postgres("postgresql://kriegsspiel:pasuworudo@localhost/prinzeugen");



async function getGrabbers(user){
	const response = await sql`select "grabbers" from "users" where "id" = ${user}`;
	if (response[0]?.grabbers)
		return response[0].grabbers || [];
	else
		return null;
}

const grabberConfigs = await getGrabbers(user);
const config = grabberConfigs[0];
const glb = grabbersMeta["gelbooru"];

// and ("message"->>'version')::int = 3 limit 5
const dump = await sql`select * from "pool" where "user" = ${user}`;
for (const entry of dump) {
	if (entry.message.version === 3 || entry.message.version === 4) {
		const button = entry.message.links.find(l => l.text === "Gelbooru");
		if (!button) {
			console.error(`#${entry.id}: no button`);
			continue;
		}

		const ref = button.url.split("&id=")[1]
		const newMessage = await glb.verify(config, ref)

		if (!newMessage) {
			console.error(`#${entry.id}: no verify`);
			await sql`delete from pool where id = ${entry.id}`;
			continue;
		}
		await sql`update pool set ${sql({ message: newMessage, failed: false })} where id = ${entry.id}`;
		
		console.log(`#${entry.id}: updated`);
		await sleep(700);
	}
}
