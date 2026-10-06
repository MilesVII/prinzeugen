// Runs the frontend watcher and the API server together. Ctrl+C stops both.
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const frontend = Bun.spawn(["bun", "run", "frontend/build.ts", "--watch"], {
	cwd: ROOT, stdin: "inherit", stdout: "inherit", stderr: "inherit"
});
const server = Bun.spawn(["bun", "--watch", "run", "core/src/server.ts"], {
	cwd: ROOT, stdin: "inherit", stdout: "inherit", stderr: "inherit"
});

const stop = () => {
	frontend.kill();
	server.kill();
	process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await Promise.race([frontend.exited, server.exited]);
stop();
