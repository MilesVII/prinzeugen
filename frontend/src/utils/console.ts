const LABEL = "console";

function elements() {
	const details = document.querySelector<HTMLDetailsElement>("details.console");
	const summary = details?.querySelector("summary") ?? null;
	const log = details?.querySelector(":scope > div") ?? null;
	return { details, summary, log };
}

function setUnread(count: number) {
	const { details, summary } = elements();
	if (!details) return;
	details.dataset.unread = `${count}`;
	if (summary) summary.textContent = count > 0 ? `${LABEL} (${count})` : LABEL;
}

export function init(){
	const { details } = elements();
	if (!details) return;

	setUnread(0);
	details.addEventListener("toggle", () => setUnread(0));
}

/** Appends a line to the on-page console. Unread lines are counted while it is collapsed. */
export function report(message: string) {
	const { details, log } = elements();
	if (!details || !log) return;

	if (!details.open)
		setUnread(parseInt(details.dataset.unread ?? "0", 10) + 1);

	const entry = document.createElement("div");
	entry.textContent = message;
	log.prepend(entry);
}
