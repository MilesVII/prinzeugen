import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

// Admin-triggered maintenance scripts. Each run logs to logs/ops-<name>-<timestamp>.log.
// The script redirects its own output to the file, so there is no pipe back to this process:
// deploy.sh restarts this very service, and must not die with it.

const ROOT = resolve(import.meta.dir, "../../..");
const LOG_DIR = join(ROOT, "logs");
const TAIL_LINES = 60;

export const OPS = {
	backup: { script: "deploy/backup.sh", description: "dump the database and send it to Telegram" },
	deploy: { script: "deploy/deploy.sh", description: "git pull, install, build, migrate, restart the service" }
} as const;
export type OpName = keyof typeof OPS;
export const OP_NAMES = Object.keys(OPS) as OpName[];

type RunState = {
	running: boolean,
	startedAt: Date | null,
	finishedAt: Date | null,
	exitCode: number | null
};
const state: Record<OpName, RunState> = {
	backup: { running: false, startedAt: null, finishedAt: null, exitCode: null },
	deploy: { running: false, startedAt: null, finishedAt: null, exitCode: null }
};

function timestamp() {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

async function latestLog(name: OpName): Promise<{ file: string, tail: string } | null> {
	let files: string[];
	try {
		files = (await readdir(LOG_DIR)).filter(f => f.startsWith(`ops-${name}-`) && f.endsWith(".log")).sort();
	} catch {
		return null;
	}
	const file = files.at(-1);
	if (!file) return null;

	const text = await Bun.file(join(LOG_DIR, file)).text();
	const lines = text.split("\n");
	return { file, tail: lines.slice(-TAIL_LINES).join("\n").trim() };
}

export async function opsStatus() {
	return Promise.all(OP_NAMES.map(async name => ({
		name,
		description: OPS[name].description,
		...state[name],
		log: await latestLog(name)
	})));
}

export async function runOp(name: OpName): Promise<{ started: boolean, reason?: string, log?: string }> {
	if (state[name].running) return { started: false, reason: "already running" };

	await mkdir(LOG_DIR, { recursive: true });
	const logFile = join(LOG_DIR, `ops-${name}-${timestamp()}.log`);
	const script = join(ROOT, OPS[name].script);

	const proc = Bun.spawn(["bash", "-c", `exec bash "$0" >> "$1" 2>&1`, script, logFile], {
		cwd: ROOT,
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
		env: { ...process.env, HOME: process.env.HOME ?? ROOT }
	});
	proc.unref();

	state[name] = { running: true, startedAt: new Date(), finishedAt: null, exitCode: null };
	proc.exited.then(code => {
		state[name] = { running: false, startedAt: state[name].startedAt, finishedAt: new Date(), exitCode: code };
	}).catch(() => {
		state[name].running = false;
	});

	return { started: true, log: logFile.slice(ROOT.length + 1) };
}
