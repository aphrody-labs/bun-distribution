import { describe, expect, test, mock } from "bun:test";

mock.module("server-only", () => ({}));

const { isAuthorVoice } = await import("../src/lib/toriyama-words");
import { prettyDocument } from "../src/lib/toriyama-shared";

describe("Fiabilité factuelle du corpus d'interviews de Toriyama", () => {
	test("les catalogues de jouets et produits dérivés sont strictement exclus", () => {
		const falseInterviews = [
			{
				source: "Shonen Weekly Jump Spécial Edition Akira Toriyama THE WORLD Special Anime, planche 188",
				document: "Shonen Weekly Jump Spécial Edition Akira Toriyama THE WORLD Special Anime",
				subject: "Shonen Weekly Jump Spécial Edition Akira Toriyama THE WORLD Special Anime — planche 188",
			},
			{
				source: "Dragon Ball Extra Daizenshuu: Carddass Perfect File Part 1, planche 42",
				document: "Dragon Ball Extra Daizenshuu: Carddass Perfect File Part 1",
				subject: "Dragon Ball Extra Daizenshuu: Carddass Perfect File Part 1 — planche 42",
			},
			{
				source: "Dragon Ball Z: Shin Budokai Designer Diary, planche 1",
				document: "Dragon Ball Z: Shin Budokai Designer Diary",
				subject: "Shin Budokai Designer Diary",
			},
			{
				source: "Flying Postman Press April 2015 issue, planche 1",
				document: "Flying Postman Press April 2015 issue",
				subject: "Flying Postman Press",
			},
		];

		for (const ref of falseInterviews) {
			expect(isAuthorVoice(ref)).toBe(false);
		}
	});

	test("les véritables prises de parole d'auteur sont bien reconnues", () => {
		const trueInterviews = [
			{
				source: "Daizenshuu 2 : Story Guide — Super Interview (23 mai 1995)",
				document: "Interview d'Akira Toriyama — Daizenshuu 2",
				subject: "Genèse de Dragon Ball et influence des films de Jackie Chan",
			},
			{
				source: "Daizenshuu 4 : World Guide — Super Interview (24 juillet 1995)",
				document: "Dragon Ball Daizenshuu 4 — World Guide",
				subject: "L'île Papaye et le Tenkaichi Budokai inspirés d'un voyage à Bali",
			},
			{
				source: "Super Exciting Guide : Character Volume — Manga DRAGON BALL no Shinjitsu (2009)",
				document: "Dragon Ball Super Exciting Guide — Character Volume",
				subject: "Le véritable nom civil de Mr. Satan (« Mark ») et Videl (« Devil »)",
			},
			{
				source: "Super Exciting Guide : Story Volume — La Vérité sur Dragon Ball (2009)",
				document: "Dragon Ball Super Exciting Guide — Story Volume",
				subject: "Le secret de création de la posture et du nom du Kamehameha",
			},
			{
				source: "Dragon Ball Forever — Entretien d'Akira Toriyama (2004)",
				document: "Dragon Ball Forever",
				subject: "L'aversion pour les plannings et les dates limites hebdomadaires",
			},
			{
				source: "Dragon Ball Chōzenshū 4 — Rétrospective d'Akira Toriyama (2013)",
				document: "Dragon Ball Chōzenshū 4: Dragon Ball Super Encyclopedia",
				subject: "Les débuts de Dragon Ball : trois mois de répit et un voyage en Chine",
			},
			{
				source: "WIRED Japan (1997, n°1) — Entretien exclusif Akira Toriyama",
				document: "WIRED Japan 1997 #1: “Issue 3.01”",
				subject: "Le silence du papier et la liberté du lecteur face au multimédia",
			},
			{
				source: "Dragon Ball Super Tome 1 — Entretien Akira Toriyama × Toyotarō (2016)",
				document: "Entretien Toriyama × Toyotarō — Dragon Ball Super",
				subject: "Le retour du format tournoi dans l'arc du 6e Univers",
			},
			{
				source: "Saikyō Jump (Mars 2014) — Interview d'Akira Toriyama",
				document: "Saikyō Jump (2014 & 2018) — Entretiens d'Akira Toriyama",
				subject: "Gine, la mère de Son Goku et compagne de Bardock (2014)",
			},
			{
				source: "Introductions des tankōbon par Akira Toriyama (trad. Kanzenshuu) — introduction du tome 1",
				document: "toriyama_akira-toriyama-tankobon-introductions.md",
				subject: "Tome 01 — Son Goku and Friends",
			},
			{
				source: "Akira Toriyama Hetappi Manga Kenkyūjo, planche 1",
				document: "Akira Toriyama Hetappi Manga Kenkyūjo",
				subject: "Akira Toriyama Hetappi Manga Kenkyūjo — planche 1",
			},
		];

		for (const ref of trueInterviews) {
			expect(isAuthorVoice(ref)).toBe(true);
		}
	});

	test("prettyDocument formate les documents clés correctement", () => {
		expect(prettyDocument("Dragon Ball Daizenshuu 4 — World Guide")).toBe("Dragon Ball Daizenshuu 4 — World Guide");
		expect(prettyDocument("toriyama_toriyama-interviews.md")).toBe("Interviews d'Akira Toriyama");
		expect(prettyDocument("saikyo-jump-2014-toriyama")).toBe("Saikyō Jump (2014 & 2018) — Entretiens d'Akira Toriyama");
	});
});
