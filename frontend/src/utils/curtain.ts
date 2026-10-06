let pageLock = false;

/** Shows a blocking overlay. Returns false when one is already up, so callers can bail out. */
export function pullCurtain(lock: boolean, message = "Processing request"){
	const curtain = document.querySelector<HTMLElement>("#curtain");

	if (lock){
		if (pageLock) return false;
		pageLock = true;

		if (curtain) curtain.hidden = false;
		updateCurtainMessage(message);
	} else {
		pageLock = false;
		if (curtain) curtain.hidden = true;
	}
	return true;
}

export function updateCurtainMessage(message: string){
	const label = document.querySelector("#curtain-message");
	if (label) label.textContent = message;
}
