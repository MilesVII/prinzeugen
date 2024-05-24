
import { switchTabContent } from "./tabs";

let pageLock = false;
let nodeStorage: Node | undefined;

export function pullCurtain(lock: boolean, message = "Processing request", noswitch = false){
	if (lock){
		if (pageLock) return false;
		pageLock = true;

		nodeStorage = switchTabContent("state", "curtain");

		updateCurtainMessage(message);
	} else {
		pageLock = false;
		
		if (!noswitch)
			switchTabContent("state", null, nodeStorage);
		nodeStorage = undefined;
	}
	return true;
}

export function updateCurtainMessage(message: string){
	const curtain = document.querySelector("#curtain");
	if (curtain) curtain.textContent = message;
}