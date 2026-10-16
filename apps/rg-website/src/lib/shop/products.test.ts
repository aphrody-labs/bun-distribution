import { describe, expect, it } from "bun:test";

import { CATEGORY_LABELS, PRODUCTS, formatEuros, getProduct, getVariantPrice } from "./products";
import type { Product } from "./products";

describe("formatEuros", () => {
	const norm = (s: string) => s.replaceAll(/\s+/g, " ");

	it("formate des cents en EUR français", () => {
		expect(norm(formatEuros(990))).toBe("9,90 €");
		expect(norm(formatEuros(2490))).toBe("24,90 €");
		expect(norm(formatEuros(1000))).toBe("10 €");
		expect(norm(formatEuros(250))).toBe("2,50 €");
		expect(norm(formatEuros(0))).toBe("0 €");
	});

	it("gère les grosses sommes", () => {
		expect(norm(formatEuros(7990))).toBe("79,90 €");
		expect(norm(formatEuros(100_000))).toBe("1 000 €");
	});
});

describe("getProduct", () => {
	it("retourne le produit par slug", () => {
		const p = getProduct("print-a5-roy-fonteneau");
		expect(p).toBeDefined();
		expect(p?.name).toContain("Roy Fonteneau");
	});

	it("retourne undefined pour un slug inconnu", () => {
		expect(getProduct("inexistant-xyz")).toBeUndefined();
	});
});

describe("getVariantPrice", () => {
	const product = getProduct("pack-personnage-destin-billows");

	it("retourne le prix de base sans variantId", () => {
		expect(product).toBeDefined();
		expect(getVariantPrice(product!)).toBe(product!.priceCents);
	});

	it("retourne le prix de la variante (override)", () => {
		expect(getVariantPrice(product!, "complet")).toBe(7990);
	});

	it("retourne le prix de base si variante sans override", () => {
		expect(getVariantPrice(product!, "solstice")).toBe(product!.priceCents);
	});

	it("fallback prix base si variantId inconnu", () => {
		expect(getVariantPrice(product!, "ghost-variant")).toBe(product!.priceCents);
	});
});

describe("Catalogue PRODUCTS — invariants", () => {
	it("expose au moins 10 produits réels", () => {
		expect(PRODUCTS.length).toBeGreaterThanOrEqual(10);
	});

	it("a tous les slugs uniques", () => {
		const slugs = PRODUCTS.map((p) => p.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it("a tous les prix > 0 cents", () => {
		for (const p of PRODUCTS) {
			expect(p.priceCents, `${p.slug} priceCents`).toBeGreaterThan(0);
		}
	});

	it("a toutes les images comme chemin absolu /public/", () => {
		for (const p of PRODUCTS) {
			expect(p.image, `${p.slug} image`).toMatch(/^\//);
		}
	});

	it("a une catégorie reconnue pour chaque produit", () => {
		const validCategories = Object.keys(CATEGORY_LABELS);
		for (const p of PRODUCTS) {
			expect(validCategories, `${p.slug} category`).toContain(p.category);
		}
	});

	it("a des variantes avec id unique par produit", () => {
		for (const p of PRODUCTS) {
			if (!p.variants) {
				continue;
			}
			const ids = p.variants.map((v) => v.id);
			expect(new Set(ids).size, `${p.slug} variants ids unique`).toBe(ids.length);
		}
	});

	it("a des variantes avec un label non vide", () => {
		for (const p of PRODUCTS) {
			if (!p.variants) {
				continue;
			}
			for (const v of p.variants) {
				expect(v.label.trim().length, `${p.slug}/${v.id} label`).toBeGreaterThan(0);
			}
		}
	});

	it("a un stockHint parmi les valeurs autorisées si défini", () => {
		const valid: Product["stockHint"][] = [
			"in-stock",
			"low-stock",
			"preorder",
			"limited",
			undefined,
		];
		for (const p of PRODUCTS) {
			expect(valid).toContain(p.stockHint);
		}
	});

	it("a au moins un produit Pack Patreon édition limitée", () => {
		const limited = PRODUCTS.filter((p) => p.stockHint === "limited");
		expect(limited.length).toBeGreaterThanOrEqual(1);
	});

	it("a au moins un produit digital (téléchargement)", () => {
		const digital = PRODUCTS.filter((p) => p.category === "digital");
		expect(digital.length).toBeGreaterThanOrEqual(1);
	});

	it("a des prices override variants supérieurs ou égaux au priceCents de base", () => {
		// Sanity : pas de variant moins chère que le prix de base sans intention
		// (autorise <= pour cas explicit, mais le pack complet doit être > unitaire).
		const pack = getProduct("pack-personnage-destin-billows");
		const complet = pack?.variants?.find((v) => v.id === "complet");
		expect(complet?.priceCentsOverride).toBeGreaterThan(pack!.priceCents);
	});
});

describe("CATEGORY_LABELS", () => {
	it("a un label pour chaque catégorie utilisée", () => {
		const used = new Set(PRODUCTS.map((p) => p.category));
		for (const cat of used) {
			expect(CATEGORY_LABELS[cat], `label for ${cat}`).toBeTruthy();
		}
	});
});
