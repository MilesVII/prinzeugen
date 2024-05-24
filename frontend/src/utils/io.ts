type Mapping = {
	keys: string[],
	action: () => void
};

export function listenToKeyboard(preventDefault: boolean, mappings: Mapping[]){
	document.addEventListener("keydown", e => {
		const mapping = mappings.find(m => m.keys.includes(e.code));
		if (mapping) {
			if (preventDefault) e.preventDefault();
			mapping.action();
		}
	});
}