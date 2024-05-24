import { fromTemplate } from "./utils";

export function switchTabContent(group: string, target: string | null, content?: Node){
	const container = document.querySelector<HTMLElement>(`*[data-tab-container="${group}"]`);
	if (!container) {
		if (!target) return;

		const variants = document.querySelectorAll<HTMLElement>(`*[data-tab-variant-group="${group}"]`);
		if (variants.length === 0) return;

		variants.forEach(v => {
			if (v.dataset.tabVariant === target) {
				v.classList.remove("hidden");
			} else {
				v.classList.add("hidden");
			}
		});
		return;
	};
	const contents = target === null ? content : fromTemplate(`${group}-${target}`);
	if (!contents) return;

	const storage = new DocumentFragment();
	storage.append(...container.childNodes)
	container.replaceChildren(contents);
	updateTabListeners(container);
	return storage;
}

export function updateTabListeners(root: (HTMLElement | Document) = document){
	const allTabs = root.querySelectorAll<HTMLElement>(".tab");
	allTabs.forEach(tab => {
		const group = tab.dataset.tabGroup;
		const tabId = tab.dataset.tabId;
		if (group === undefined || tabId === undefined) return;

		const sibs = root.querySelectorAll(`.tab[data-tab-group="${group}"]`);
		tab.addEventListener("click", () => {
			if (tab.classList.contains("selected")) return;

			sibs.forEach(t => t.classList.remove("selected"));
			tab.classList.add("selected");
			switchTabContent(group, tabId);
		});
	});

	root.querySelectorAll<HTMLElement>("[data-tab-container]").forEach(container => {
		const tab = container.dataset.tabDefault;
		if (tab) {
			const group = container.dataset.tabContainer;
			if (group === undefined) return;

			switchTabContent(group, tab);
		}
	});
}