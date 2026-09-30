/**
 * Politique d'optimisation des images.
 *
 * Le site servait tout en JPEG source (`unoptimized: true` global). Une vignette
 * d'épisode de 780×585 pesait ~60 Kio contre ~10 Kio en AVIF à la largeur rendue,
 * et le lecteur de databooks chargeait des scans jusqu'à 5 Mio pour un affichage
 * de 768 px — ou pour une vignette de 48 px.
 *
 * Le seul contenu qui reste NON optimisé est ce qui est remplaçable en place
 * depuis l'admin (`assets/wiki/**`) : ces images doivent rester fraîches dès leur
 * remplacement, ce que le cache disque de l'optimiseur empêcherait pendant un
 * jour (durée dictée par le `Cache-Control` de la source).
 */
import { describe, expect, test } from "bun:test";
import {
	LARGEURS_OPTIMISEUR,
	isEditableAsset,
	optimizedSrc,
	optimizedSrcSet,
} from "../src/lib/images";

const IMPORTEE = "https://bot.dragonballfr.com/assets/ext/db_episodes/1.jpg";
const TELEVERSEE = "https://bot.dragonballfr.com/assets/wiki/databooks/abc.jpg";

describe("isEditableAsset", () => {
	test("ne reconnaît que les téléversements de l'admin", () => {
		expect(isEditableAsset(TELEVERSEE)).toBe(true);
		expect(isEditableAsset("./assets/wiki/characters/goku.webp")).toBe(true);
		expect(isEditableAsset(IMPORTEE)).toBe(false);
		expect(isEditableAsset("https://bot.dragonballfr.com/db/toei/x.jpg")).toBe(false);
	});

	test("une source absente n'est pas éditable", () => {
		expect(isEditableAsset(null)).toBe(false);
		expect(isEditableAsset(undefined)).toBe(false);
		expect(isEditableAsset("")).toBe(false);
	});
});

describe("optimizedSrc", () => {
	test("passe par l'optimiseur et encode la source", () => {
		const u = optimizedSrc(IMPORTEE, 1080);
		expect(u).toStartWith("/_next/image?url=");
		expect(u).toContain(encodeURIComponent(IMPORTEE));
		expect(u).toContain("w=1080");
		expect(u).toContain("q=70");
	});

	test("arrondit à une largeur AUTORISÉE par next.config", () => {
		// Une largeur absente de l'allow-list est refusée (400) par l'optimiseur :
		// c'est elle qui empêche un tiers de faire recalculer toutes les tailles.
		for (const demande of [10, 77, 300, 900, 5000]) {
			const w = Number(/w=(\d+)/.exec(optimizedSrc(IMPORTEE, demande))![1]);
			expect(LARGEURS_OPTIMISEUR).toContain(w as never);
		}
	});

	test("ne descend jamais sous la largeur demandée", () => {
		expect(optimizedSrc(IMPORTEE, 300)).toContain("w=384");
		expect(optimizedSrc(IMPORTEE, 96)).toContain("w=96");
	});

	test("laisse intacte une image remplaçable en place", () => {
		expect(optimizedSrc(TELEVERSEE, 1080)).toBe(TELEVERSEE);
		expect(optimizedSrcSet(TELEVERSEE, [828, 1080])).toBe("");
	});
});

describe("optimizedSrcSet", () => {
	test("décrit chaque variante avec son descripteur de largeur", () => {
		const set = optimizedSrcSet(IMPORTEE, [828, 1080, 1920]);
		expect(set.split(", ")).toHaveLength(3);
		expect(set).toContain("828w");
		expect(set).toContain("1080w");
		expect(set).toContain("1920w");
	});
});
