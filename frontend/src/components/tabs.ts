// Ported from aegir (src/components/tabs.ts): <ram-tabs tab="x"> containing <ram-tab key="x">,
// switched by setting the "tab" attribute or by <ram-tab-button for="id" tab="x">.

const TAG_NAME = {
	button: "ram-tab-button",
	tab:    "ram-tab",
	tabs:   "ram-tabs"
};

class RampikeTab extends HTMLElement {
	get key() {
		return this.getAttribute("key") ?? "";
	}
	set key(value: string) {
		this.setAttribute("key", value);
	}

	constructor() {
		super();
		this.style.display = "contents";
	}
}

class RampikeTabContainer extends HTMLElement {
	static get observedAttributes() { return ["tab"]; }
	attributeChangedCallback(name: string, oldValue: string, value: string) {
		if (name !== "tab") return;
		if (oldValue === value) return;
		this.tab = value;
	}

	constructor() {
		super();
		this.style.display = "contents";
		this.update();
	}

	get tab() {
		return this.getAttribute("tab") ?? "";
	}
	set tab(value: string) {
		if (value !== this.tab) this.setAttribute("tab", value);
		this.update();
	}

	private update() {
		const value = this.tab;
		this.querySelectorAll<RampikeTab>(TAG_NAME.tab).forEach(tab => {
			if (findParentTabContainer(tab) !== this) return;

			const hidden = tab.key !== value;
			tab.hidden = hidden;
			tab.style.display = hidden ? "none" : "contents";
		});

		if (this.id) {
			// attributes, not the `active` accessor: buttons may not be upgraded yet when this runs
			const buttons = document.querySelectorAll<HTMLElement>(`${TAG_NAME.button}[for="${this.id}"]`);
			buttons.forEach(b => {
				if (b.getAttribute("tab") === value)
					b.setAttribute("tab-active", "true");
				else
					b.removeAttribute("tab-active");
			});
		}
	}
}

class RampikeTabButton extends HTMLElement {
	get tab() {
		return this.getAttribute("tab");
	}
	get active(): boolean {
		return this.getAttribute("tab-active") === "true";
	}
	set active(value: boolean) {
		if (value)
			this.setAttribute("tab-active", "true");
		else
			this.removeAttribute("tab-active");
	}
	constructor() {
		super();
		this.setAttribute("role", "tab");
		this.tabIndex = 0;
		const activate = () => {
			const containerId = this.getAttribute("for");
			const tab = this.getAttribute("tab");
			if (!containerId || !tab) return;

			const container = document.querySelector<RampikeTabContainer>(`${TAG_NAME.tabs}#${containerId}`);
			if (!container) return;
			container.tab = tab;
			this.dispatchEvent(new CustomEvent("tab-pick", { detail: { tab }, bubbles: true }));
		};
		this.addEventListener("click", activate);
		this.addEventListener("keydown", e => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				activate();
			}
		});
	}
}

export function define() {
	// buttons first, so the container's initial update finds upgraded elements
	window.customElements.define(TAG_NAME.button, RampikeTabButton);
	window.customElements.define(TAG_NAME.tab,    RampikeTab);
	window.customElements.define(TAG_NAME.tabs,   RampikeTabContainer);
}
export type RampikeTabs = RampikeTabContainer;

export function switchTab(containerId: string, tab: string) {
	const container = document.querySelector<RampikeTabContainer>(`${TAG_NAME.tabs}#${containerId}`);
	if (container) container.tab = tab;
}

function findParentTabContainer(origin: HTMLElement) {
	let target = origin.parentElement;
	while (target !== null && target.tagName !== TAG_NAME.tabs.toUpperCase()) {
		target = target.parentElement;
	}
	return target;
}
