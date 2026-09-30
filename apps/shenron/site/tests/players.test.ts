/**
 * Présélection du lecteur vidéo.
 *
 * L'interface ouvre le PREMIER lecteur du tableau. Cet ordre venait tel quel de
 * l'ingest voir-anime : sur les sept hébergeurs historiques, six sont morts ou
 * bloqués (streamhide, filemoon, voe, streamtape, et link rot partiel sur
 * mail.ru/yourupload) — seul vidmoly répond de façon fiable. Rien dans le code
 * ne garantissait que ce soit lui qui s'ouvre : ça tenait à l'ordre d'insertion.
 */
import { describe, expect, test } from "bun:test";
import { orderPlayers } from "../src/lib/players";

const p = (provider: string, name = provider) => ({
	provider,
	name,
	embedUrl: `https://${provider}`,
});

describe("orderPlayers", () => {
	test("vidmoly passe devant les hébergeurs moins fiables", () => {
		const r = orderPlayers([p("yourupload"), p("mailru"), p("vidmoly")])!;
		expect(r.map((x) => x.provider)).toEqual(["vidmoly", "mailru", "yourupload"]);
	});

	test("un hébergeur constaté mort finit en queue, jamais présélectionné", () => {
		const r = orderPlayers([p("streamhide"), p("voe"), p("yourupload")])!;
		expect(r[0]!.provider).toBe("yourupload");
		expect(
			r
				.map((x) => x.provider)
				.slice(1)
				.sort()
		).toEqual(["streamhide", "voe"]);
	});

	test("le tri est stable : à fiabilité égale, l'ordre d'origine tient", () => {
		// Cas réel : VF puis VOSTFR chez le même hébergeur — l'ordre importé compte.
		const r = orderPlayers([p("vidmoly", "VF"), p("vidmoly", "VOSTFR")])!;
		expect(r.map((x) => x.name)).toEqual(["VF", "VOSTFR"]);
	});

	test("un hébergeur inconnu se place après les fiables, avant les morts", () => {
		const r = orderPlayers([p("streamhide"), p("nouveau"), p("vidmoly")])!;
		expect(r.map((x) => x.provider)).toEqual(["vidmoly", "nouveau", "streamhide"]);
	});

	test("insensible à la casse du fournisseur", () => {
		const r = orderPlayers([p("YourUpload"), p("VIDMOLY")])!;
		expect(r[0]!.provider).toBe("VIDMOLY");
	});

	test("une valeur jsonb corrompue ne fait pas tomber la page", () => {
		// `players` a déjà été écrit en scalaire par le passé (piège `sql.json`).
		for (const entree of [null, undefined, "pas un tableau", 42, {}]) {
			expect(orderPlayers(entree as never)).toBeNull();
		}
	});

	test("une liste vide reste une liste vide", () => {
		expect(orderPlayers([])).toEqual([]);
	});
});
