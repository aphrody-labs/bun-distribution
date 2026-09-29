export async function loadFs(): Promise<unknown> {
	const specifier = "node:fs";
	return import(specifier);
}
