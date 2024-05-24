export function init(){
	const console = document.querySelector<HTMLElement>(".console");
	if (!console) return;

	console.addEventListener("toggle", () => console.dataset.unread = "0");
}

export function report(message: string) {
	const console = document.querySelector<HTMLDetailsElement>("details.console");
	if (!console) return;

	if (console.dataset.unread === undefined) console.dataset.unread = "0";

	if (!console.open)
		console.dataset.unread = `${parseInt(console.dataset.unread, 10) + 1}`;

	const contents = console.querySelector("details > div");
	if (!contents) return;

	const entry = document.createElement("div");
	entry.textContent = message;

	contents.prepend(entry);
}
