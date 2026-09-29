import { constant } from "case";

// Helpers purs portables ré-exportés depuis @rosegriffon/achillea-core/validation.
export { isValidUrl, numberAlign, validString } from "@rosegriffon/achillea-core";

export function oneLine(strings: TemplateStringsArray, ...keys: any[]) {
	return strings
		.reduce((result, part, i) => result + part + (keys[i] ?? ""), "")
		.replace(/(?:\n(?:\s*))+/g, " ")
		.split("NEWLINE")
		.join("\n")
		.trim();
}

export function constantPreserveDots(string: string) {
	return string
		.split(".")
		.map((word) => constant(word))
		.join(".");
}
