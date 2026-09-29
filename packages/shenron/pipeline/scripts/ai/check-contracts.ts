#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Validate Shenron's wire schemas and recorded response fixtures locally. */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as wire from "../../src/ai/wire";

const fixturesDir = resolve(import.meta.dir, "../../test/ai/fixtures");
const errors: string[] = [];
const schemas = wire as unknown as Record<
	string,
	{ safeParse?(value: unknown): { success: boolean }; shape?: Record<string, unknown> } | undefined
>;

const requestMirrors: Readonly<Record<string, keyof typeof wire.WIRE_STRUCTS>> = {
	RagSearchQuery: "ShenronSearchQuery",
	IngestRequest: "ShenronDocument",
	SyncFinishRequest: "ShenronSyncFinish",
	ChatMessage: "ChatMessage",
	ChatRequest: "ChatRequest",
	OcrRequest: "OcrRequest",
	VisionRequest: "VisionRequest",
	EmbedRequest: "ShenronEmbedRequest",
};

for (const [schemaName, structName] of Object.entries(requestMirrors)) {
	const actual = Object.keys(schemas[schemaName]?.shape ?? {}).toSorted();
	const expected = [...wire.WIRE_STRUCTS[structName]].toSorted();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		errors.push(`${schemaName}: schema fields differ from WIRE_STRUCTS.${structName}`);
	}
}

interface Fixture {
	route: string | null;
	schema: string;
	requestSchema?: string;
	request?: unknown;
	response: Record<string, unknown>;
}

const files = readdirSync(fixturesDir)
	.filter((name) => name.endsWith(".json"))
	.toSorted();
for (const file of files) {
	const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
	if (!schemas[fixture.schema]?.safeParse?.(fixture.response).success) {
		errors.push(`${file}: response does not parse with ${fixture.schema}`);
	}
	if (fixture.request !== undefined) {
		const requestSchema = fixture.requestSchema ? schemas[fixture.requestSchema] : undefined;
		if (!requestSchema?.safeParse?.(fixture.request).success) {
			errors.push(`${file}: request does not parse with ${fixture.requestSchema ?? "a schema"}`);
		}
	}
	if (fixture.route !== null && !(fixture.route in wire.SHENRON_ROUTES)) {
		errors.push(`${file}: unknown route ${fixture.route}`);
	}
}

if (errors.length > 0) {
	for (const error of errors) console.error(`check-contracts: FAIL ${error}`);
	process.exit(1);
}
console.log(`check-contracts: OK (${files.length} fixtures)`);
