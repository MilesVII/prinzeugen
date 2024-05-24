import * as forms from "./forms";

function tagList(raw: string): string[] {
	return raw
		.split("\n")
		.map(line => line.trim().replaceAll(" ", "_"))
		.filter(tag => tag != "");
}

export type Grabber = {
	type: GrabberType,
	form: forms.FormSchema<forms.PEFieldAdditionals>,
	read: (container: HTMLElement) => any,
	fill: (container: HTMLElement, data: any) => void
};

export const GLB_FORM: forms.FormSchema<forms.PEFieldAdditionals> = [
	forms.fieldSchema<forms.PEFieldAdditionals>("user", "line", {
		label: "Gelbooru user"
	}),
	forms.fieldSchema<forms.PEFieldAdditionals>("api", "line", {
		label: "Gelbooru API key"
	}),
	forms.fieldSchema<forms.PEFieldAdditionals>("tags", "list", {
		label: "Tags",
		lineCount: true
	}),
	forms.fieldSchema<forms.PEFieldAdditionals>("whitelist", "list", {
		label: "Whitelist",
		placeholder: "sort:id:asc and id:>lastseen are added autmoatically",
		lineCount: true
	}),
	forms.fieldSchema<forms.PEFieldAdditionals>("blacklist", "list", {
		label: "Blacklist",
		lineCount: true
	}),
	forms.fieldSchema<forms.PEFieldAdditionals>("lastSeen", "line", {
		label: "Last checked post ID"
	})
];

type GelbooruGrabberInstance = {
	type: "gelbooru",
	credentials: {
		user: number,
		token: string
	},
	config: {
		tags: string[],
		whites: string[],
		blacks: string[],
		moderated: boolean
	},
	state: {
		lastSeen: number
	}
};

const GelbooruGrabber: Grabber = {
	type: "gelbooru",
	form: GLB_FORM,
	read: container => {
		const formData = forms.readForm(container, GLB_FORM);
		const instance: GelbooruGrabberInstance = {
			type: "gelbooru",
			credentials: {
				user: parseInt(formData.user?.trim() ?? "0", 10),
				token: formData.api?.trim()
			},
			config: {
				tags: formData.tags ? tagList(formData.tags) : [""],
				whites: formData.whitelist ? tagList(formData.whitelist) : [""],
				blacks: formData.blacklist ? tagList(formData.blacklist) : [""],
				moderated: true
			},
			state: {
				lastSeen: parseInt(formData.lastSeen ?? "0", 10)
			}
		};
		return instance;
	},
	fill: (container, data: GelbooruGrabberInstance) => {
		const formData = {
			user: `${data.credentials.user}`,
			api: data.credentials.token,

			tags: data.config.tags.join("\n"),
			blacklist: data.config.blacks.join("\n"),
			whitelist: data.config.whites.join("\n"),

			lastSeen: `${data.state.lastSeen}`
		};
		forms.fillForm(container, formData);

		// forms.getFieldElement("tags")?.addEventListener("input", () => updateGrabberFlicker(el));
		// forms.getFieldElement("blacklist")?.addEventListener("input", () => updateGrabberFlicker(el));
	}
}
// function updateGrabberFlicker(el: HTMLElement) {
// 	genericFlickerUpdate("#gb_tags", "#gb_tflicker", contents => [contents.split("\n").length], el);
// 	genericFlickerUpdate("#gb_blacks", "#gb_bflicker", contents => [contents.split("\n").length], el);
// }

export const Grabbers = {
	"gelbooru": GelbooruGrabber
};

export type GrabberType = keyof typeof Grabbers;