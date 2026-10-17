import { mudcrack } from "rampike";
import { api, safe, zip, load, save, el } from "./utils/utils";
import { pullCurtain, updateCurtainMessage } from "./utils/curtain";
import { displayGrabbers, downloadGrabbers } from "./grabbing";
import { report } from "./utils/console";

const CONCURRENT_QUERIES = 2;
const CREDENTIALS_KEY = "gelbooru-credentials";
const PROXY_BASE = "/proxie/gelbooru.com/index.php";

type PostCount = {
	artist: string,
	count: "error" | "empty" | "exists_in_grabber" | number
};

type Credentials = {
	user: string,
	key: string
};

/** The refeeder is not a grabber, so its gelbooru credentials live in this browser only */
export function initFeederCredentials() {
	const userInput = el<HTMLInputElement>("#refeeder-user");
	const keyInput = el<HTMLInputElement>("#refeeder-key");
	if (!userInput || !keyInput) return;

	const stored = load(CREDENTIALS_KEY) as Partial<Credentials> | null;
	userInput.value = stored?.user ?? "";
	keyInput.value = stored?.key ?? "";

	const persist = () => save(CREDENTIALS_KEY, readCredentials() ?? { user: userInput.value.trim(), key: keyInput.value.trim() });
	userInput.addEventListener("input", persist);
	keyInput.addEventListener("input", persist);
}

function readCredentials(): Credentials | null {
	const user = el<HTMLInputElement>("#refeeder-user")?.value.trim() ?? "";
	const key = el<HTMLInputElement>("#refeeder-key")?.value.trim() ?? "";
	if (!user || !key) return null;
	return { user, key };
}

export async function refeed() {
	const artists = parseArtistList();
	if (artists.length <= 0) return;

	const credentials = readCredentials();
	if (!credentials) {
		report("Gelbooru user id and API key are required to count posts per artist. Fill them in above.");
		return;
	}

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
		const activeQueue: string[] = [];

		const grabCount = Math.min(queue.length, CONCURRENT_QUERIES);
		for (let i = 0; i < grabCount; ++i) {
			const fresh = queue.pop();
			if (!fresh) break;

			const dupe = checkExisting(fresh, grabbers);
			if (dupe)
				results.push(dupe);
			else
				activeQueue.push(fresh);
		}

		const promiseResults = await Promise.allSettled(activeQueue.map(a => artistPostCount(a, credentials)));

		const rows = zip(
			activeQueue.map(artist => ({ artist })),
			promiseResults
		);

		const postCounts = rows.map(
			({ artist, ...result}) =>
				({
					artist,
					count: result.status === "fulfilled" ? result.value : "error"
				}) as PostCount
			);

		results.push(...postCounts);

		const percentage = results.length / artists.length * 100;
		updateCurtainMessage(`Collecting meta: ${percentage.toFixed(2)}%`);
	}

	updateCurtainMessage(`Updating memo`);
	const newMemo = await updateList(results, oldMemo);

	pullCurtain(false);

	displayGrabbers(grabbers);
	if (newMemo) setMemo(newMemo);
	renderResults(results);
	refreshFeederList();
}

function parseArtistList() {
	const input = el<HTMLTextAreaElement>("#refeeder-input");
	if (!input) return [];

	return input.value
		.split("\n")
		.map(line => line.trim())
		.filter(line => line);
}

async function artistPostCount(artist: string, credentials: Credentials): Promise<PostCount["count"]> {
	const params = new URLSearchParams({
		page: "dapi",
		s: "post",
		q: "index",
		tags: artist,
		pid: "0",
		json: "1",
		limit: "0",
		api_key: credentials.key,
		user_id: credentials.user
	});

	const response = await fetch(`${PROXY_BASE}?${params}`);
	if (!response.ok) return "error";

	const payload = await response.json().catch(() => null);
	const count = payload?.["@attributes"]?.count;
	if (typeof count !== "number") return "error";
	return count || "empty";
}

function renderResults(results: PostCount[]) {
	const container = el("#refeeder-log");
	if (!container) return;

	const VALUES = {
		error: ["refeeder-log-value-error", "error"],
		empty: ["refeeder-log-value-error", "no posts found"],
		exists_in_grabber: ["refeeder-log-value-dupe", "exists in grabber"]
	} as const;

	container.append(...results.flatMap(result => {
		const [className, text] = typeof result.count === "number"
			? ["refeeder-log-value-ok", `${result.count}`]
			: VALUES[result.count];
		return [
			mudcrack({ contents: result.artist }),
			mudcrack({ className, contents: text })
		];
	}));
}

function readMemo() {
	const memoContainer = el<HTMLTextAreaElement>("#settings-additional");
	if (!memoContainer) return;

	return memoContainer.value ?? "";
}

function setMemo(newMemo: string) {
	const memoContainer = el<HTMLTextAreaElement>("#settings-additional");
	if (!memoContainer) return;

	memoContainer.value = newMemo;
	memoContainer.dispatchEvent(new Event("input"));
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
				};
			} else {
				return {
					feeder: newList
				};
			}
		}
	}

	const newMemo = getNewMemo();
	const newMemoString = JSON.stringify(newMemo, undefined, "\t");

	await api.patch("/api/settings", { additional: newMemoString });

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
	const listContainer = el("#refeeder-list");
	if (!listContainer) return;
	listContainer.innerHTML = "";

	const memo = parseMemo(readMemo());
	if (!memo.parsed?.feeder) return;
	const list = memo.list();

	const sections = ([
		["heavy", list.filter(([, count]) => count >= 200)],
		["medium", list.filter(([, count]) => count >= 120 && count < 200)],
		["light", list.filter(([, count]) => count < 120)]
	] as const).filter(([, list]) => list.length > 0);

	listContainer.append(...sections.flatMap(([name, section]) => [
		mudcrack({ className: "refeeder-section", contents: `${name} (${section.length})` }),
		...[...section]
			.sort(([, a], [, b]) => b - a)
			.map(([artist, count]) => mudcrack({
				className: "refeeder-row",
				contents: [
					mudcrack({ contents: artist }),
					mudcrack({ tagName: "span", className: "refeeder-list-counter", contents: `${count}` })
				]
			}))
	]));
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

	const grabberArtists: string[] = grabbers
		.filter(grabber => grabber?.type === "gelbooru")
		.flatMap(grabber => grabber.config?.tags ?? []);

	const newList = oldList.filter(([artist]) => !grabberArtists.includes(artist));

	const delta = oldList.length - newList.length;
	let newMemoString = null;
	if (delta !== 0) {
		report(`Removing ${delta} ${delta === 1 ? "artist" : "artists"} from feeder`);

		oldMemo.parsed.feeder = Object.fromEntries(newList);
		newMemoString = JSON.stringify(oldMemo.parsed, undefined, "\t");

		updateCurtainMessage("Updating memo");
		await api.patch("/api/settings", { additional: newMemoString });
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
	};

	return {
		raw: memo,
		parsed,
		list
	};
}
