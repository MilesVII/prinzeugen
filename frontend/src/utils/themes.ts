import { fromTemplateFirst } from "./utils";

const STORAGE_KEY_THEME = "theme";
const CSS_THEMES_FILE = "theme.css";

export function initTheme() {
	const theme = window.localStorage.getItem(STORAGE_KEY_THEME);
	if (theme) switchTheme(theme);
}

/** Lists every .theme-* class found in theme.css as a clickable swatch */
export function renderThemeSelectors(container: HTMLElement) {
	const rules: CSSStyleRule[] = [];
	for (const sheet of Array.from(document.styleSheets)) {
		if (!sheet.href?.includes(CSS_THEMES_FILE)) continue;
		try {
			rules.push(...Array.from(sheet.cssRules).filter((r): r is CSSStyleRule => r instanceof CSSStyleRule));
		} catch {
			// cross-origin sheet, not ours
		}
	}

	const names = rules
		.map(r => r.selectorText.match(/^\.theme-([\w-]+)$/)?.[1])
		.filter((name): name is string => !!name);

	container.innerHTML = "";
	container.append(...names.map(selectorItem).filter((e): e is SVGElement => e !== null));
}

function selectorItem(name: string) {
	const swatch = fromTemplateFirst<any>("template-theme-selector") as SVGElement | null;
	if (!swatch) return null;
	const themeClassName = `theme-${name}`;
	swatch.classList.add(themeClassName);
	swatch.setAttribute("title", name.replaceAll("-", " "));
	swatch.addEventListener("click", () => switchTheme(themeClassName));
	return swatch;
}

function switchTheme(themeClassName: string) {
	document.body.classList.forEach(c => {
		if (c.startsWith("theme-")) document.body.classList.remove(c);
	});
	document.body.classList.add(themeClassName);
	window.localStorage.setItem(STORAGE_KEY_THEME, themeClassName);
}
