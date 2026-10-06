import { app, INDEX } from "./app.ts";
import { env } from "./env.ts";

app.listen(env.port);

console.log(`Listening on ${app.server?.url}`);
if (!(await INDEX.exists()))
	console.warn(`No frontend build found. Run "bun run build" first.`);
