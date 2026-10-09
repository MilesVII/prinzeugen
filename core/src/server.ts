import { app, INDEX } from "./app.ts";
import { env } from "./env.ts";
import { startScheduler } from "./services/jobs.ts";

app.listen(env.port);

console.log(`Listening on ${app.server?.url}`);
if (!(await INDEX.exists()))
	console.warn(`No frontend build found. Run "bun run build" first.`);

startScheduler().catch(error => console.error("scheduler failed to start", error));
