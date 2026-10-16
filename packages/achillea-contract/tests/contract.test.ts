import { describe, expect, test } from "bun:test";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { emitJsonSchema } from "../src/emit-json-schema";
import { emitKotlin } from "../src/emit-kotlin";
import { emitRust } from "../src/emit-rust";
import { emitSwift } from "../src/emit-swift";
import { ContractExtractionError, extractContract } from "../src/extract";
import { generateContract } from "../src/generate";
import { indexDeclarations, type IrContract } from "../src/ir";
import { rustFieldName, toPascalCase, toSnakeCase } from "../src/naming";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES_ROOT = join(PACKAGE_ROOT, "..", "achillea-types", "src");

const contract: IrContract = extractContract({ root: TYPES_ROOT });
const byName = indexDeclarations(contract);

describe("extraction", () => {
	test("le contrat entier est extrait sans construction non prise en charge", () => {
		expect(contract.declarations.length).toBeGreaterThan(100);
		expect(new Set(contract.declarations.map((d) => d.name)).size).toBe(
			contract.declarations.length
		);
	});

	test("les enums conservent leurs valeurs de fil", () => {
		const stageType = byName.get("StageType");
		expect(stageType?.kind).toBe("enum");
		if (stageType?.kind !== "enum") throw new Error("StageType manquant");
		expect(stageType.valueType).toBe("string");
		expect(stageType.members.map((m) => m.value)).toEqual([
			"round_robin",
			"single_elimination",
			"double_elimination",
			"league",
		]);
	});

	test("les enums numériques gardent leur valeur explicite", () => {
		const matchMode = byName.get("MatchMode");
		if (matchMode?.kind !== "enum") throw new Error("MatchMode manquant");
		expect(matchMode.valueType).toBe("number");
		expect(matchMode.members).toEqual([
			{ name: "ONE_VS_ONE", value: 2, doc: undefined },
			{ name: "TWO_VS_TWO", value: 4, doc: undefined },
		]);
	});

	test("l'optionalité est fidèle", () => {
		const user = byName.get("UserDTO");
		if (user?.kind !== "interface") throw new Error("UserDTO manquant");
		const optional = new Set(user.fields.filter((f) => f.optional).map((f) => f.name));
		expect(optional.has("avatar")).toBe(true);
		expect(optional.has("id")).toBe(false);
		expect(optional.has("username")).toBe(false);
	});

	test("l'héritage d'interface est résolu", () => {
		const tournament = byName.get("Tournament");
		if (tournament?.kind !== "interface") throw new Error("Tournament manquant");
		expect(tournament.extends.map((e) => e.name)).toEqual(["EventEntity"]);
	});

	test("`Date` est reconnu comme horodatage, pas comme objet libre", () => {
		const clan = byName.get("ClanDTO");
		if (clan?.kind !== "interface") throw new Error("ClanDTO manquant");
		expect(clan.fields.find((f) => f.name === "createdAt")?.type).toEqual({ kind: "date" });
	});

	test("le résultat classé référence l'union complète, y compris draw", () => {
		const entry = byName.get("RankedHistoryEntry");
		if (entry?.kind !== "interface") throw new Error("RankedHistoryEntry manquant");
		const result = entry.fields.find((f) => f.name === "result");
		expect(result?.type).toEqual({ kind: "ref", name: "MatchResult", args: [] });
		const matchResult = byName.get("MatchResult");
		if (matchResult?.kind !== "alias") throw new Error("MatchResult manquant");
		expect(matchResult.type).toEqual({
			kind: "union",
			of: [
				{ kind: "literal", value: "win" },
				{ kind: "literal", value: "loss" },
				{ kind: "literal", value: "draw" },
				{ kind: "literal", value: "forfeit" },
			],
		});
	});

	test("`Exclude` résout une union de littéraux", () => {
		const fixture = extractContract({ root: join(PACKAGE_ROOT, "tests", "fixtures", "exclude") });
		const result = indexDeclarations(fixture).get("RankedResult");
		if (result?.kind !== "alias") throw new Error("RankedResult manquant");
		expect(result.type).toEqual({
			kind: "union",
			of: [
				{ kind: "literal", value: "win" },
				{ kind: "literal", value: "loss" },
				{ kind: "literal", value: "forfeit" },
			],
		});
	});
});

describe("JSON Schema", () => {
	const schema = emitJsonSchema(contract);

	test("chaque déclaration a sa définition", () => {
		expect(Object.keys(schema.$defs).length).toBe(contract.declarations.length);
		expect(schema.$schema).toContain("2020-12");
	});

	test("un enum devient une énumération de valeurs, pas d'identifiants", () => {
		const stageType = schema.$defs["StageType"] as { enum: string[]; type: string };
		expect(stageType.type).toBe("string");
		expect(stageType.enum).toContain("single_elimination");
	});

	test("les champs requis sont listés, les optionnels non", () => {
		const user = schema.$defs["UserDTO"] as { required: string[] };
		expect(user.required).toContain("id");
		expect(user.required).not.toContain("avatar");
	});

	test("`Date` porte le format date-time", () => {
		const clan = schema.$defs["ClanDTO"] as {
			properties: Record<string, { type?: string; format?: string }>;
		};
		expect(clan.properties["createdAt"]).toMatchObject({ type: "string", format: "date-time" });
	});

	test("l'héritage est aplati dans les propriétés", () => {
		const tournament = schema.$defs["Tournament"] as { properties: Record<string, unknown> };
		// `name` vient d'`EventEntity`.
		expect(tournament.properties["name"]).toBeDefined();
		expect(tournament.properties["internalState"]).toBeDefined();
	});

	test("tous les $ref pointent vers une définition existante", () => {
		const refs = [...JSON.stringify(schema).matchAll(/"#\/\$defs\/([^"]+)"/gu)].map(
			(match) => match[1] as string
		);
		expect(refs.length).toBeGreaterThan(50);
		const missing = [...new Set(refs)].filter((name) => !(name in schema.$defs));
		expect(missing).toEqual([]);
	});
});

describe("Rust", () => {
	const rust = emitRust(contract);

	test("les mots réservés sont échappés", () => {
		expect(rustFieldName("type")).toBe("r#type");
		expect(rust).toContain("pub r#type:");
	});

	test("le renommage serde préserve le nom du fil", () => {
		expect(rust).toContain('#[serde(rename = "soloRank")]');
		expect(rust).toContain("pub solo_rank: Option<RankDto>,");
	});

	test("les optionnels sont des Option sautés à la sérialisation", () => {
		expect(rust).toContain('skip_serializing_if = "Option::is_none"');
	});

	test("les enums numériques passent par serde_repr", () => {
		expect(rust).toContain("Serialize_repr, Deserialize_repr");
		expect(rust).toContain("#[repr(i64)]");
	});

	test("une intersection devient une struct aplatie", () => {
		expect(rust).toContain("#[serde(flatten)]");
		expect(rust).toContain("pub base: UserDto,");
	});

	test("aucun identifiant ne reste en casse TypeScript", () => {
		expect(rust).not.toContain("pub clanAvatarUrl");
		expect(rust).toContain("pub clan_avatar_url:");
	});
});

describe("Swift et Kotlin", () => {
	test("Swift émet des structs Codable avec CodingKeys quand le nom diffère", () => {
		const swift = emitSwift(contract);
		expect(swift).toContain("public struct UserDTO");
		expect(swift).toContain("public enum CodingKeys: String, CodingKey");
		expect(swift).toContain("public let soloRank: RankDTO");
	});

	test("Kotlin émet des data class sérialisables", () => {
		const kotlin = emitKotlin(contract);
		expect(kotlin).toContain("@Serializable");
		expect(kotlin).toContain("data class UserDTO(");
		expect(kotlin).toContain("enum class StageType");
		expect(kotlin).toContain('@SerialName("single_elimination")');
	});

	test("le nom de package Kotlin est paramétrable", () => {
		expect(emitKotlin(contract, "com.exemple.jeu")).toContain("package com.exemple.jeu");
	});
});

describe("casse", () => {
	test("snake_case gère les acronymes et les noms déjà en snake", () => {
		expect(toSnakeCase("clanAvatarUrl")).toBe("clan_avatar_url");
		expect(toSnakeCase("xUrl")).toBe("x_url");
		expect(toSnakeCase("x_url")).toBe("x_url");
		expect(toSnakeCase("HTTPServer")).toBe("http_server");
	});

	test("PascalCase normalise les enums", () => {
		expect(toPascalCase("single_elimination")).toBe("SingleElimination");
		expect(toPascalCase("ONE_VS_ONE")).toBe("OneVsOne");
	});
});

describe("génération", () => {
	test("les quatre cibles sont produites et non vides", () => {
		const { files } = generateContract({ root: TYPES_ROOT });
		expect(files.map((f) => f.file)).toEqual([
			"achillea.schema.json",
			"achillea.rs",
			"Achillea.swift",
			"Achillea.kt",
		]);
		for (const file of files) expect(file.content.length).toBeGreaterThan(1000);
	});

	test("les fichiers versionnés dans generated/ sont à jour", async () => {
		const { files } = generateContract({
			root: TYPES_ROOT,
			version: ((await Bun.file(join(TYPES_ROOT, "..", "package.json")).json()) as {
				version?: string;
			}).version,
		});
		for (const { file, content } of files) {
			const onDisk = await Bun.file(join(PACKAGE_ROOT, "generated", file)).text();
			expect(onDisk, `${file} est périmé — lancer \`bun run generate\``).toBe(content);
		}
	});
});

describe("héritage utilitaire et unions nommées", () => {
	const schema = emitJsonSchema(contract);
	const rust = emitRust(contract);

	test("`extends Omit<…>` conserve les champs du parent", () => {
		// Régression : `Omit` était ignoré, et `WireTournament` ne gardait que
		// ses quatre champs propres — les trente de `Tournament` disparaissaient
		// du Rust et du JSON Schema sans le moindre avertissement.
		const wire = schema.$defs["WireTournament"] as { properties: Record<string, unknown> };
		const base = schema.$defs["Tournament"] as { properties: Record<string, unknown> };

		expect(Object.keys(wire.properties).length).toBeGreaterThan(30);
		expect(wire.properties["name"]).toBeDefined();
		expect(wire.properties["internalState"]).toBeDefined();
		// Les clés omises sont bien redéfinies, pas héritées telles quelles.
		expect(wire.properties["organization"]).not.toEqual(base.properties["organization"]);
	});

	test("`Omit` hors héritage échoue bruyamment plutôt que d'être aplati", () => {
		// Le principe du paquet : ce qu'on ne sait pas traduire lève une erreur
		// localisée, au lieu de finir en `unknown` dans le fichier généré.
		expect(() =>
			extractContract({ root: join(PACKAGE_ROOT, "tests", "fixtures", "bad-omit") })
		).toThrow(ContractExtractionError);
	});

	test("un triplet reste un triplet", () => {
		const detail = schema.$defs["TournamentDetail"] as {
			type: string;
			prefixItems: unknown[];
			minItems: number;
		};
		expect(detail.type).toBe("array");
		expect(detail.prefixItems).toHaveLength(3);
		expect(detail.minItems).toBe(3);
		expect(rust).toContain("pub type TournamentDetail = (WireTournament, Vec<WireParticipant>,");
	});

	test("une union hétérogène devient un enum non étiqueté", () => {
		// `pub type EntityRef<T> = serde_json::Value` ne compile pas (E0091) :
		// Rust refuse un alias dont le paramètre générique n'est pas utilisé.
		expect(rust).toContain("#[serde(untagged)]");
		expect(rust).toContain("pub enum EntityRef<T>");
		expect(rust).toContain("\tEntity(T),");
		expect(rust).not.toContain("pub type EntityRef<T> = serde_json::Value;");
	});

	test("le contrat couvre désormais l'administration et les championnats", () => {
		for (const name of [
			"AdminOpsOverview",
			"DbQueryResult",
			"LeagueSeasonPayload",
			"SuccessResponse",
			"RealtimeTokenResponse",
			"WireParticipant",
		]) {
			expect(schema.$defs[name], `${name} absent du contrat`).toBeDefined();
		}
	});
});
