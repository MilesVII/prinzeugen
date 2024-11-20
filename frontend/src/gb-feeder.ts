import { callAPI, fromTemplate, sleep, chunk, zip, safe } from "./utils/utils";
import { pullCurtain, updateCurtainMessage } from "./utils/curtain";
import { displayGrabbers, downloadGrabbers } from "./grabbing";
import { report } from "./utils/console";

const CONCURRENT_QUERIES = 2;

type PostCount = {
	artist: string,
	count: "error" | "empty" | "exists_in_grabber" | number
};

export async function refeed() {
	const artists = parseArtistList();

	if (artists.length <= 0) return;

	const oldMemo = readMemo();
	if (typeof oldMemo !== "string") return;

	pullCurtain(true, "Updating grabbers");
	const grabbers = await downloadGrabbers();
	if (!grabbers) {
		pullCurtain(false);
		return;
	}

	updateCurtainMessage("Collecting meta");
	const queue = [...artists];
	const results: PostCount[] = [];
	while (queue.length > 0) {
		const activeQueue = [];

		const grabCount = Math.min(queue.length, CONCURRENT_QUERIES);
		for (let i = 0; i < grabCount; ++i) {
			const fresh = queue.pop();
			if (!fresh) break;

			const dupe = checkExisting(fresh, grabbers);
			if (dupe)
				results.push(dupe)
			else
				activeQueue.push(fresh);
		}

		const promiseResults = await Promise.allSettled(activeQueue.map(a => artistPostCount(a)));

		const rows = zip(
			activeQueue.map(artist => ({ artist })),
			promiseResults
		);

		const postCounts = rows.map(
			({ artist, ...result}) =>
				({
					artist,
					count: result.status === "fulfilled" ? result.value : "error"
				})
			);

		results.push(...postCounts);
		
		const percentage = results.length / artists.length * 100;
		updateCurtainMessage(`Collecting meta: ${percentage.toFixed(2)}%`);
	}

	updateCurtainMessage(`Updating memo`);
	const newMemo = await updateList(results, oldMemo);

	pullCurtain(false);

	displayGrabbers(grabbers);
	if (newMemo) setMemo(newMemo)
	renderResults(results);
	refreshFeederList();
}

function parseArtistList() {
	const input = document.querySelector<HTMLTextAreaElement>("#refeeder-input");
	if (!input) return [];

	const artists = input.value
		.split("\n")
		.map(line => line.trim())
		.filter(line => line);
	
	return artists;
}

async function artistPostCount(artist: string): Promise<PostCount["count"]> {
	function buildURLParams(params: Record<string, string>) {
		return Object.keys(params)
			.map(param => `${param}=${encodeURIComponent(params[param])}`)
			.join("&");
	}

	const params = buildURLParams({
		page: "dapi",
		s: "post",
		q: "index",
		tags: artist,
		pid: "0",
		json: "1",
		limit: "0"
		// api_key: grabber.credentials.token,
		// user_id: grabber.credentials.user
	});
	const url = `gelbooru.com/index.php?${params}`;
	const proxied = `https://prinzeugen.fokses.pro/proxie/${url}`;

	const response = await fetch(proxied);

	if (response.ok){
		const count = (await response.json())["@attributes"].count as number ?? "error";
		return count || "empty";
	} else
		return "error";
}

function renderResults(results: PostCount[]) {
	const container = document.querySelector("#refeeder-log");
	if (!container) return;

	results.forEach(result => {
		const name = document.createElement("div");
		name.textContent = result.artist;

		const value = document.createElement("div");
		if (typeof result.count === "number") {
			value.className = "refeeder-log-value-ok";
			value.textContent = `${result.count}`;
		} else {
			switch (result.count) {
				case ("error"): {
					value.className = "refeeder-log-value-error";
					value.textContent = "ERROR";
					break;
				}
				case ("empty"): {
					value.className = "refeeder-log-value-error";
					value.textContent = "NO POSTS FOUND";
					break;
				}
				case ("exists_in_grabber"): {
					value.className = "refeeder-log-value-dupe";
					value.textContent = "Exists in grabber";
					break;
				}
				// case ("exists_in_list"): {
				// 	value.className = "refeeder-log-value-dupe";
				// 	value.textContent = "Exists in the list";
				// 	break;
				// }
			}
		}
		
		container.append(name, value);
	});
}

function readMemo() {
	const memoContainer = document.querySelector<HTMLTextAreaElement>("#settings-additional");
	if (!memoContainer) return;

	return memoContainer?.value ?? "";
}

function setMemo(newMemo: string) {
	const memoContainer = document.querySelector<HTMLTextAreaElement>("#settings-additional");
	if (!memoContainer) return;

	return memoContainer.value = newMemo;
}

async function updateList(results: PostCount[], oldMemo: string) {
	function getNewMemo() {
		const newResults = results.filter(({ count }) => typeof count === "number");
		const newList = Object.fromEntries(newResults.map(row => [row.artist, row.count as number]));

		const memo = parseMemo(oldMemo);

		if (memo.parsed?.feeder) {
			return {
				...memo.parsed,
				feeder: {
					...memo.parsed.feeder,
					...newList
				}
			};
		} else {
			if (memo.raw) {
				return {
					feeder: newList,
					old: memo.raw
				}
			} else {
				return {
					feeder: newList
				}
			}
		}
	}

	const newMemo = getNewMemo();
	const newMemoString = JSON.stringify(newMemo, undefined, "\t");
	
	await callAPI("saveSettings", {
		additionalData: newMemoString
	}, true);

	return newMemoString;
}

function checkExisting(artist: string, grabbers: any[]): PostCount | null {
	const foundInGrabbers = grabbers
		.filter(grabber => grabber?.type === "gelbooru")
		.find(grabber => grabber.config?.tags?.includes(artist));

	if (foundInGrabbers) {
		return { artist, count: "exists_in_grabber" };
	}

	return null;
}

export function refreshFeederList() {
	const memo = parseMemo(readMemo());
	if (!memo.parsed?.feeder) return;
	const list = memo.list();

	const sections = ([
		["Heavy", list.filter(([, count]) => count >= 200)],
		["Medium", list.filter(([, count]) => count >= 120 && count < 200)],
		["Light", list.filter(([, count]) => count < 120)]
	] as const).filter(([, list]) => list.length > 0);

	const listContainer = document.querySelector("#refeeder-list");
	if (!listContainer) return;
	listContainer.innerHTML = "";

	sections.forEach(([name, section]) => {
		const title = document.createElement("div");
		title.className = "refeeder-section";
		title.textContent = name;
		listContainer.append(title);

		section
			.sort(([, a], [, b]) => b - a)
			.forEach(([artist, count]) => {
				const valueContainer = document.createElement("div");
				valueContainer.className = "container row unpad";

				const value = document.createElement("div");
				value.textContent = artist;
				
				const counter = document.createElement("span");
				counter.className = "refeeder-list-counter";
				counter.textContent = `${count}`;
				
				valueContainer.append(value, counter);
				listContainer.append(valueContainer);
			});
	});
}

export async function updateFeederList() {
	const oldMemo = parseMemo(readMemo());
	const oldList = oldMemo.list();
	if (!oldMemo.parsed || !oldList) return;

	pullCurtain(true, "Updating grabbers");
	const grabbers = await downloadGrabbers();
	if (!grabbers) {
		pullCurtain(false);
		return;
	}

	const grabberArtists = grabbers
		.filter(grabber => grabber?.type === "gelbooru")
		.map(grabber => grabber.config?.tags)
		.reduce((p, c) => {
			p.push(...c);
			return p;
		}, []);

	const newList = oldList.filter(([artist]) => !grabberArtists.includes(artist));

	const delta = oldList.length - newList.length;
	let newMemoString = null;
	if (delta !== 0) {
		report(`Removing ${delta} ${delta === 1 ? "artist" : "artists"} from feeder`);
		
		oldMemo.parsed.feeder = Object.fromEntries(newList);
		newMemoString = JSON.stringify(oldMemo.parsed, undefined, "\t");
		
		updateCurtainMessage("Updating memo");
		await callAPI("saveSettings", {
			additionalData: newMemoString
		}, true);
	} else {
		report("No duplicates found, nothing to update");
	}

	pullCurtain(false);

	if (newMemoString) setMemo(newMemoString);
	displayGrabbers(grabbers);
	refreshFeederList();
}

function parseMemo(memo: string = "") {
	const parsed = safe(() => JSON.parse(memo));

	const list = () => {
		if (!parsed?.feeder) return [];
		const oldFeeder = parsed.feeder as Record<string, number>;
		return Object.keys(oldFeeder)
			.map(artist =>
				[artist, oldFeeder[artist]] as [artist: string, count: number]
			);
	}

	return {
		raw: memo,
		parsed,
		list
	};
}