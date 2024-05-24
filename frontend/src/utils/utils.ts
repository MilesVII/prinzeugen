
const api = window.location.hostname === "localhost" ? "https://prinzeugen.fokses.pro/api" : "/api"

export async function callAPI(action: string, data: Record<string, any> | null, useLogin = true){
	function safeParse(str: string){
		return safe(() => JSON.parse(str));
	}

	let login = null;
	if (useLogin){
		const loginData = load("login");
		login = {
			user: loginData.id,
			userToken: loginData.token
		};
	} 

	const response = await fetch(api, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(Object.assign({
			action: action
		}, data, login))
	});

	const raw = await response.text();
	const payload = safeParse(raw) || raw;

	if (response.status != 200) console.error(raw);

	return {
		status: response.status,
		headers: response.headers,
		data: payload
	};
}

export function chunk<T>(a: T[], chunksize: number): T[][] {
	let r: T[][] = [];
	for (let i = 0; i < a.length; i += chunksize){
		r.push(a.slice(i, i + chunksize));
	}
	return r;
}

export function fromTemplate(id: string) {
	return document.querySelector<HTMLTemplateElement>(`template#${id}`)?.content.cloneNode(true) ?? null;
}

export function safe<T>(cb: () => T): T | null {
	try {
		return cb();
	} catch(e){
		return null;
	}
}

export function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export function gbToUnix(raw: string) {
	const r = raw.split(" ")
	const fixed = `${r[2]} ${r[1]} ${r[5]} ${r[3]} GMT`;
	return Date.parse(fixed);
}

export function setElementValue(query: string, value: any, propertyName = "value") {
	const e = document.querySelector(query);
	if (e === null) return;
	(e as any)[propertyName] = value;
}

export function load(key: string) {
	return JSON.parse(localStorage.getItem(key) || "null");
}

export function save(key: string, data: any) {
	if (data)
		localStorage.setItem(key, JSON.stringify(data));
	else
		localStorage.removeItem(key);
}

export function conditionedList<T>(...pairs: [boolean, T][]): T[] {
	return (pairs
		.filter(([condition]) => condition)
		.map(([_c, value]) => value));
}
