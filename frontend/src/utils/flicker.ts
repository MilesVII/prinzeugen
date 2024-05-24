
type GenericFlickerCallback = (content: string) => [string, string | undefined];
export function genericFlickerUpdate(taQ: string, flQ: string, cb: GenericFlickerCallback, root: (Element | Document) = document) {
	const textarea = root.querySelector<HTMLTextAreaElement>(taQ);
	const flicker = root.querySelector<HTMLElement>(flQ);
	if (!flicker) return;

	const contents = textarea?.value.trim() ?? "";

	const [text, color = "transparent"] = cb(contents);

	flicker.textContent = text;
	flicker.style.backgroundColor = color;
}