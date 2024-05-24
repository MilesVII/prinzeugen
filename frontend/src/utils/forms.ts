import { fromTemplate } from "./utils";
import { genericFlickerUpdate } from "./flicker";

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

function fieldFromTemplate(field: FieldSchema<PEFieldAdditionals>){
	function getProto(id: string) {
		const raw = fromTemplate(id);
		const proto = (raw as HTMLElement)?.firstElementChild;
		if (proto){
			return proto;
		} else {
			console.error(`Failed to render form field from template "${id}"`);
			return null;
		}
	}

	switch (field.type){
		case ("line"): {
			const templateName = "generic-field-line";
			const proto = getProto(templateName);
			if (!proto) return null;

			const label = proto.querySelector("label");
			if (label) label.textContent = field.additional.label;

			const input = proto.querySelector("input");
			if (!input) {
				console.error(`Can't find <input> inside "${templateName}" template`);
				return null;
			};
			input.placeholder = field.additional.placeholder ?? "";
			input.setAttribute(`data-grabber-form-${field.key}`, "");

			return proto;
		}
		case ("list"): {
			const templateName = "generic-field-multiline";
			const proto = getProto(templateName);
			if (!proto) return null;

			const label = proto.querySelector("label");
			if (label) label.textContent = field.additional.label;

			const textarea = proto.querySelector("textarea");
			if (!textarea) {
				console.error(`Can't find <textarea> inside "${templateName}" template`);
				return null;
			}
			textarea.placeholder = field.additional.placeholder ?? "";
			textarea.setAttribute(`data-grabber-form-${field.key}`, "");

			if (field.additional.lineCount) {
				const textareaFU = () => genericFlickerUpdate(
					"textarea",
					"legend > span",
					(content) => ([`${content.split("\n").filter(line => line.trim().length > 0).length}`, undefined]),
					proto
				);
				textarea.addEventListener("input", textareaFU);
			}

			return proto;
		}
	}
}

export function renderForm(schema: FormSchema<PEFieldAdditionals>): DocumentFragment {
	const container = new DocumentFragment();
	const rendered = schema
		.map(s => fieldFromTemplate(s))
		.filter(s => s !== null) as Element[];
	container.append(...rendered);
	return container;
}

export function getFieldElement(container: HTMLElement, fieldKey: string) {
	return container.querySelector(`*[data-grabber-form-${fieldKey}]`);
}

export function readForm(container: HTMLElement, schema: FormSchema<PEFieldAdditionals>) {
	function readField(fieldKey: string, fieldType: string){
		const fieldElement = getFieldElement(container, fieldKey);
		if (!fieldElement) return null;

		return (fieldElement as any)?.value ?? null;
	}

	const r: Record<string, string> = {};

	schema.forEach(s => {
		const v = readField(s.key, s.type);
		r[s.key] = v;
	});

	return r;
}

export function fillForm(form: HTMLElement, data: Record<string, string>) {
	for (const key of Object.keys(data)){
		const field = getFieldElement(form, key);
		if (field) {
			(field as any).value = data[key];
			field.dispatchEvent(new Event("input"));
		}
	}
	return form;
}
