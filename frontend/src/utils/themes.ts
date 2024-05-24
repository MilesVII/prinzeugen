import { fromTemplate } from "./utils";

export function init() {
	const theme = window.localStorage.getItem("theme");
	if (theme) switchTheme(theme);
}

export function selectorList() {
	const rules: CSSStyleRule[] = []
	for (const ss of document.styleSheets)
		if (ss.href?.startsWith(window.location.href)) {
			const raw = [...ss.cssRules];
			rules.push(...raw.filter(r => r.constructor.name === "CSSStyleRule") as any);
		}
	
	// @ts-ignore
	const themes: RegExpMatchArray[] = rules
		.map(r => r.selectorText.match(/\.theme-(.*)/))
		.filter(r => r);
	
	const container = new DocumentFragment();
	// @ts-ignore
	container.append(...themes.map(t => selectorItem(...t)));
	return container;
}

function selectorItem(cssSelector: string, name: string){
	const button = fromTemplate("theme-selector");
	if (!button) return null;
	const svg = (button as Element).firstElementChild;
	if (!svg) return null;
	const themeClassName = `theme-${name}`;
	svg.classList.add(themeClassName);
	svg.addEventListener("click", () => switchTheme(themeClassName))
	return svg;
}

function switchTheme(themeClassName: string) {
	document.body.classList.forEach(c => {
		if (c.startsWith("theme-")) document.body.classList.remove(c);
	});
	document.body.classList.add(themeClassName);
	window.localStorage.setItem("theme", themeClassName);
}