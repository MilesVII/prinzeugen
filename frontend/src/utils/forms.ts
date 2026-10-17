import { mudcrack } from "rampike";

export type FieldType = "line" | "list";
export type FieldSchema<T = Record<string, string>> = {
	key: string,
	type: FieldType,
	additional: T
}
export type FormSchema<T = Record<string, string>> = FieldSchema<T>[];

export function fieldSchema<T>(key: string, type: FieldType, additional: T): FieldSchema<T> {
	return {
		key,
		type,
		additional
	};
}

export type PEFieldAdditionals = {
	label: string,
	placeholder?: string,
	lineCount?: boolean
};

function countLines(text: string) {
	return text.split("\n").filter(line => line.trim().length > 0).length;
}

/** fieldset with a legend; the input carries data-grabber-form-<key> so read/fill can find it */
function renderField(field: FieldSchema<PEFieldAdditionals>) {
	const { label, placeholder = "", lineCount } = field.additional;
	const marker = `data-grabber-form-${field.key}`;

	if (field.type === "line") {
		return mudcrack({
			tagName: "fieldset",
			contents: [
				mudcrack({ tagName: "legend", contents: [mudcrack({ tagName: "label", contents: label })] }),
				mudcrack({
					tagName: "input",
					className: "strip",
					attributes: { type: "text", autocomplete: "off", placeholder, [marker]: "" }
				})
			]
		});
	}

	const counter = lineCount ? mudcrack({ tagName: "span", className: "hint" }) : null;
	return mudcrack({
		tagName: "fieldset",
		contents: [
			mudcrack({
				tagName: "legend",
				contents: [mudcrack({ tagName: "label", contents: label }), counter]
			}),
			mudcrack({
				tagName: "textarea",
				className: "strip",
				attributes: { rows: 4, spellcheck: "false", placeholder, [marker]: "" },
				events: counter ? {
					input: (_, textarea) => { counter.textContent = `${countLines(textarea.value)}`; }
				} : {}
			})
		]
	});
}

export function renderForm(schema: FormSchema<PEFieldAdditionals>): HTMLElement[] {
	return schema.map(renderField);
}

export function getFieldElement(container: HTMLElement, fieldKey: string) {
	return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`*[data-grabber-form-${fieldKey}]`);
}

export function readForm(container: HTMLElement, schema: FormSchema<PEFieldAdditionals>) {
	const r: Record<string, string | null> = {};
	schema.forEach(s => {
		r[s.key] = getFieldElement(container, s.key)?.value ?? null;
	});
	return r;
}

export function fillForm(form: HTMLElement, data: Record<string, string>) {
	for (const key of Object.keys(data)){
		const field = getFieldElement(form, key);
		if (field) {
			field.value = data[key] ?? "";
			field.dispatchEvent(new Event("input"));
		}
	}
	return form;
}
