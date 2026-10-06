export type FlickerState = "ok" | "bad" | undefined;
type GenericFlickerCallback = (content: string) => [text: string, state?: FlickerState];

/** Mirrors a textarea's content into a small status badge (line count, JSON validity, ...) */
export function genericFlickerUpdate(taQ: string, flQ: string, cb: GenericFlickerCallback, root: (Element | Document) = document) {
	const textarea = root.querySelector<HTMLTextAreaElement>(taQ);
	const flicker = root.querySelector<HTMLElement>(flQ);
	if (!flicker) return;

	const contents = textarea?.value.trim() ?? "";

	const [text, state] = cb(contents);

	flicker.textContent = text;
	if (state)
		flicker.dataset.state = state;
	else
		delete flicker.dataset.state;
}
