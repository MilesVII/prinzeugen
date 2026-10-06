// Frontend build: copies static/ into dist/ and bundles src/main.ts into dist/ts/main.js.
// `bun run build.ts --watch` keeps both in sync while developing.
import { rm, mkdir, cp, watch } from "node:fs/promises";
import { join } from "node:path";

const ROOT = import.meta.dir;
const STATIC = join(ROOT, "static");
const DIST = join(ROOT, "dist");
const ENTRY = join(ROOT, "src/main.ts");

const watching = Bun.argv.includes("--watch");

async function copyStatic() {
	await cp(STATIC, DIST, { recursive: true });
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await copyStatic();

if (watching) {
	const bundler = Bun.spawn(
		["bun", "build", ENTRY, "--outdir", join(DIST, "ts"), "--target", "browser", "--sourcemap=linked", "--watch"],
		{ cwd: ROOT, stdin: "inherit", stdout: "inherit", stderr: "inherit" }
	);

	const stop = () => {
		bundler.kill();
		process.exit(0);
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);

	console.log("watching static/ for changes");
	for await (const event of watch(STATIC, { recursive: true })) {
		console.log(`static changed: ${event.filename}`);
		await copyStatic();
	}
} else {
	const result = await Bun.build({
		entrypoints: [ENTRY],
		outdir: join(DIST, "ts"),
		target: "browser",
		sourcemap: "linked",
		minify: false
	});

	if (!result.success) {
		for (const log of result.logs) console.error(log);
		process.exit(1);
	}
	for (const output of result.outputs) {
		console.log(`${output.path.slice(ROOT.length + 1)}  ${(output.size / 1024).toFixed(1)} KB`);
	}
}
