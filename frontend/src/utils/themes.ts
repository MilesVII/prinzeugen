import { mudcrack } from "rampike";

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

	container.replaceChildren(...names.map(selectorItem));
}

/** The swatch paints the theme's own variables (see .theme-selector), so it needs only the theme class */
function selectorItem(name: string) {
	const themeClassName = `theme-${name}`;
	return mudcrack({
		className: `theme-selector ${themeClassName}`,
		attributes: { title: name.replaceAll("-", " "), role: "button", tabindex: 0 },
		events: {
			click: () => switchTheme(themeClassName),
			keydown: event => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				switchTheme(themeClassName);
			}
		}
	});
}

function switchTheme(themeClassName: string) {
	document.body.classList.forEach(c => {
		if (c.startsWith("theme-")) document.body.classList.remove(c);
	});
	document.body.classList.add(themeClassName);
	window.localStorage.setItem(STORAGE_KEY_THEME, themeClassName);
}
