import { sleep } from "./utils";

type UpscaleTask = {
	running: boolean,
	aborted: boolean,
	target: HTMLElement,
	start: (t: UpscaleTask, abortSignal: AbortSignal) => Promise<void>,
	abort?: () => void
};

const UPSCALE_RETRY_COUNT = 3;
const TOTAL_RETRY_COUNT = 12;
const CONCURRENT_TASKS = 3;

const tasks: UpscaleTask[] = [];
let totalRetryCount = TOTAL_RETRY_COUNT;

async function upscale(t: UpscaleTask, abortSignal: AbortSignal, e: HTMLElement, retriesLeft = UPSCALE_RETRY_COUNT){
	if (e.dataset.upscaled && retriesLeft === UPSCALE_RETRY_COUNT) return;

	e.dataset.upscaled = "weewee";

	const url = `/imageproxy?bypass=1&url=${e.dataset.original}`;

	const response = await fetch(url, { signal: abortSignal });
	if (t.aborted) return;

	if (response.status === 504) {
		if (retriesLeft <= 0) return;
		if (--totalRetryCount <= 0) return;

		await sleep(Math.random() * 5000);
		await upscale(t, abortSignal, e, retriesLeft - 1);
		return;
	}

	if (!response.ok) return;
	if (!response.headers.get("content-type")?.startsWith("image/")) return;

	const data = await response.arrayBuffer();
	const blob = new Blob([data]);

	const image = e.querySelector("img");
	if (image) image.src = URL.createObjectURL(blob);
}

export function loadTasks(moderables: HTMLElement[]) {
	flushTasks();

	const newTasks = moderables.map(e => ({
			running: false,
			aborted: false,
			target: e,
			start: (t, abortSignal) => upscale(t, abortSignal, e, UPSCALE_RETRY_COUNT),
		}) as UpscaleTask
	);

	tasks.push(...newTasks);
}

export function flushTasks() {
	totalRetryCount = TOTAL_RETRY_COUNT;
	tasks.forEach(t => {
		t.abort?.();
		t.aborted = true;
	});
	tasks.splice(0);
}

export function runTasks(onComplete: () => void) {
	const runningTasks = tasks.filter(t => t.running);
	if (runningTasks.length >= CONCURRENT_TASKS) return;

	const tasksToStart =
		tasks
			.filter(t => !t.running)
			.slice(0, CONCURRENT_TASKS - runningTasks.length);
	
	tasksToStart.forEach(t => {
		const controller = new AbortController();
		t.running = true;
		t.abort = controller.abort;
		t.start(t, controller.signal).finally(() => {
			const index = tasks.findIndex(task => task.target === t.target);
			tasks.splice(index, 1);
			runTasks(onComplete);
			if (tasks.length === 0) onComplete();
		});
	});
}

export function isBusy() {
	return tasks.some(t => t.running);
}
