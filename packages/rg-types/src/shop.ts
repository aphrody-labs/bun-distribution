/**
 * Catalogue produits Rose Griffon — source de vérité côté code.
 *
 * Convention prix : `priceCents` en centimes d'euros (Stripe-native).
 * Chaque produit peut avoir des `variants` (taille, artiste, etc.) qui agissent
 * comme des SKUs séparés au checkout. Si pas de variant, l'achat est direct.
 *
 * Images : référencer un asset déjà présent dans `apps/website/public/`.
 * `tags` servent au filtrage côté UI (chip filter dans /shop).
 */

export type ProductCategory =
	| "pack-patreon"
	| "print"
	| "sticker"
	| "marque-page"
	| "badge"
	| "textile"
	| "affiche"
	| "carte"
	| "digital";

export interface ProductVariant {
	id: string;
	label: string;
	priceCentsOverride?: number;
	image?: string;
}

export interface Product {
	slug: string;
	name: string;
	tagline: string;
	description: string;
	priceCents: number;
	category: ProductCategory;
	image: string;
	gallery?: string[];
	variants?: ProductVariant[];
	tags: string[];
	stockHint?: "in-stock" | "low-stock" | "preorder" | "limited";
	patreonExclusive?: boolean;
	highlights?: string[];
}

export const PRODUCTS: Product[] = [
	{
		category: "pack-patreon",
		description:
			"Pack collector autour de Destin Billows : un print A5 signé, un marque-page assorti, un sticker exclusif et un grand badge brodé. Choisissez votre artiste favori parmi Solstice, Ethan, Rayjang ou Pauline — ou prenez le pack complet pour collectionner les 4 visions.",
		gallery: ["/patreon/destin.webp", "/patreon/destin-mobile.webp"],
		highlights: [
			"1 print A5 papier 250g mat",
			"1 marque-page assorti",
			"1 sticker exclusif vinyle découpé",
			"1 grand badge brodé Ø 56mm",
			"Livré sous pochette kraft signée",
		],
		image: "/patreon/destin.webp",
		name: "Pack Personnage — Édition Destin Billows",
		priceCents: 2490,
		slug: "pack-personnage-destin-billows",
		stockHint: "limited",
		tagline: "Édition limitée illustrée par 4 artistes Rose Griffon",
		tags: ["édition limitée", "print", "marque-page", "sticker", "badge"],
		variants: [
			{ id: "solstice", label: "Illustration · Solstice" },
			{ id: "ethan", label: "Illustration · Ethan" },
			{ id: "rayjang", label: "Illustration · Rayjang" },
			{ id: "pauline", label: "Illustration · Pauline" },
			{
				id: "complet",
				label: "Pack complet · 4 artistes",
				priceCentsOverride: 7990,
			},
		],
	},
	{
		category: "print",
		description:
			"Impression A5 papier mat 250g de la carte personnage Roy Fonteneau, capitaine défensif de Rose Griffon. Diagonale or/marine/rouge signature, citation iconique au verso.",
		highlights: [
			"Format A5 (148 × 210 mm)",
			"Papier mat 250g qualité galerie",
			"Citation au verso",
			"Tirage non numéroté",
		],
		image: "/RG_roy_LC.webp",
		name: "Print A5 · Roy Fonteneau",
		priceCents: 990,
		slug: "print-a5-roy-fonteneau",
		stockHint: "in-stock",
		tagline: "Trading card style Inazuma TV — défense n°07",
		tags: ["print", "personnage", "Roy"],
	},
	{
		category: "print",
		description:
			"Impression A5 papier mat 250g de Gaëlle La Goatte, le génie créatif de Rose Griffon. Palette vermillon/or, format collector encadrable.",
		highlights: [
			"Format A5 (148 × 210 mm)",
			"Papier mat 250g qualité galerie",
			"Couleurs vermillon/or vibrantes",
		],
		image: "/gaelle_lagoatte_pfp.webp",
		name: "Print A5 · Gaëlle La Goatte",
		priceCents: 990,
		slug: "print-a5-gaelle-la-goatte",
		stockHint: "in-stock",
		tagline: "Portrait signature — milieu de terrain emblématique",
		tags: ["print", "personnage", "Gaëlle"],
	},
	{
		category: "sticker",
		description:
			"Lot de 5 stickers vinyle découpé représentant les emotes Discord les plus iconiques de Rose Griffon. Résistants à l'eau, parfaits sur ordinateur portable, gourde ou cahier.",
		highlights: [
			"5 stickers chibi exclusifs",
			"Vinyle découpé, finition mat",
			"Résistant à l'eau et aux UV",
			"Format 60–80 mm chaque",
		],
		image: "/emote.webp",
		name: "Sticker Pack · Communauté",
		priceCents: 790,
		slug: "sticker-pack-communaute",
		stockHint: "in-stock",
		tagline: "5 stickers chibi vinyle découpé",
		tags: ["sticker", "emote", "lot"],
	},
	{
		category: "sticker",
		description:
			"Sticker vinyle découpé du fameux Mark Evans tenant son cœur d'or — l'emote la plus utilisée sur le Discord Rose Griffon.",
		highlights: ["Vinyle découpé 80 mm", "Résistant eau + UV"],
		image: "/emote.webp",
		name: "Sticker · Mark Evans cœur d'or",
		priceCents: 250,
		slug: "sticker-mark-evans",
		stockHint: "in-stock",
		tagline: "Le mascot officiel de la communauté",
		tags: ["sticker", "Mark Evans"],
	},
	{
		category: "marque-page",
		description:
			"Trio de marque-pages assortis sur les trois figures de la communauté Rose Griffon. Papier mat 350g, pelliculage soft-touch, gland coton.",
		highlights: [
			"3 marque-pages assortis",
			"Papier 350g pelliculage soft-touch",
			"Gland coton coloré",
		],
		image: "/da/staffRG.webp",
		name: "Pack 3 Marque-pages",
		priceCents: 450,
		slug: "marque-page-trio",
		stockHint: "in-stock",
		tagline: "Roy / Gaëlle / Mark — papier mat 350g",
		tags: ["marque-page", "lot"],
	},
	{
		category: "badge",
		description:
			"Grand badge brodé reprenant le logo Rose Griffon (silhouette griffon + éclair Inazuma + rose). Brodage 7 couleurs, dos sécurité, finition propre.",
		highlights: ["Diamètre 56 mm", "Brodage 7 couleurs", "Dos sécurité plastique"],
		image: "/mark.webp",
		name: "Grand Badge brodé · Rose Griffon",
		priceCents: 390,
		slug: "badge-brode-rose-griffon",
		stockHint: "in-stock",
		tagline: "Logo Griffon × Éclair Inazuma — Ø 56 mm",
		tags: ["badge", "brodé", "logo"],
	},
	{
		category: "textile",
		description:
			"T-shirt édition limitée Rose Griffon, sérigraphie 3 couleurs avec le logo griffon central et le marquage Inazuma Eleven France au dos. Coton biologique 180g/m².",
		highlights: [
			"100% coton biologique 180g/m²",
			"Sérigraphie 3 couleurs",
			"Coupe unisexe",
			"Édition limitée 200 exemplaires",
		],
		image: "/mark.webp",
		name: "T-shirt · Rose Griffon Édition Limitée",
		priceCents: 2490,
		slug: "tshirt-rose-griffon-edition",
		stockHint: "limited",
		tagline: "100% coton bio, sérigraphie 3 couleurs",
		tags: ["textile", "édition limitée"],
		variants: [
			{ id: "s", label: "Taille S" },
			{ id: "m", label: "Taille M" },
			{ id: "l", label: "Taille L" },
			{ id: "xl", label: "Taille XL" },
			{ id: "xxl", label: "Taille XXL" },
		],
	},
	{
		category: "affiche",
		description:
			"Affiche A2 célébrant la rencontre des deux pôles Rose Griffon (la maison mère) et Achillea (l'e-sport Inazuma Eleven). Illustration originale, papier 200g semi-mat.",
		gallery: ["/mural1.webp", "/mural2.webp"],
		highlights: ["Format A2 (420 × 594 mm)", "Papier 200g semi-mat", "Édition tirage 100 ex"],
		image: "/mural1.webp",
		name: "Affiche A2 · Achillea × Rose Griffon",
		priceCents: 1990,
		slug: "affiche-a2-achillea-rose-griffon",
		stockHint: "low-stock",
		tagline: "Murale collector — édition compétition e-sport",
		tags: ["affiche", "Achillea", "édition limitée"],
	},
	{
		category: "carte",
		description:
			"Reproduction officielle de la carte trading Roy Fonteneau en version foil holographique. Format carte à jouer 63×88mm, vernis sélectif sur la diagonale jaune.",
		highlights: ["Format 63 × 88 mm", "Foil holographique", "Vernis sélectif", "Sleeve incluse"],
		image: "/RG_roy_LC.webp",
		name: "Carte Trading · Roy Fonteneau (Foil)",
		priceCents: 490,
		slug: "carte-trading-roy-foil",
		stockHint: "limited",
		tagline: "Édition foil holographique limitée",
		tags: ["carte", "foil", "édition limitée", "Roy"],
	},
	{
		category: "digital",
		description:
			"Pack digital de 5 emotes au format PNG transparent 112×112, 56×56 et 28×28, prêts à uploader sur votre serveur Discord ou chaîne Twitch. Lien de téléchargement envoyé après paiement.",
		highlights: [
			"5 emotes au format PNG transparent",
			"3 tailles (112/56/28 px)",
			"Téléchargement immédiat",
			"Licence usage personnel + serveur Discord",
		],
		image: "/emote.webp",
		name: "Pack Emotes Discord/Twitch",
		priceCents: 590,
		slug: "emote-pack-discord-twitch",
		stockHint: "in-stock",
		tagline: "5 emotes custom Rose Griffon (téléchargement digital)",
		tags: ["digital", "emote", "Discord", "Twitch"],
	},
	{
		category: "sticker",
		description:
			"Sticker collector édité pour les contributeurs du wiki Azalée. Logo Azalée dégradé rose-orange officiel, format 80mm.",
		highlights: [
			"Vinyle découpé 80 mm",
			"Dégradé rose → orange officiel",
			"Édition contributeurs wiki",
		],
		image: "/RG_Azalee-logo.webp",
		name: "Sticker · Azalée Wiki Founder",
		priceCents: 290,
		slug: "sticker-azalee-wiki-founder",
		stockHint: "limited",
		tagline: "Édition collector — wiki azalee.rosegriffon.fr",
		tags: ["sticker", "Azalée", "édition limitée"],
	},
] as const;

export function getProduct(slug: string): Product | undefined {
	return PRODUCTS.find((p) => p.slug === slug);
}

export function getVariantPrice(product: Product, variantId?: string): number {
	if (!variantId || !product.variants) {
		return product.priceCents;
	}
	const v = product.variants.find((v) => v.id === variantId);
	return v?.priceCentsOverride ?? product.priceCents;
}

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
	affiche: "Affiches",
	badge: "Badges",
	carte: "Cartes",
	digital: "Digital",
	"marque-page": "Marque-pages",
	"pack-patreon": "Packs Patreon",
	print: "Prints",
	sticker: "Stickers",
	textile: "Textile",
};

export function formatEuros(cents: number): string {
	return new Intl.NumberFormat("fr-FR", {
		currency: "EUR",
		minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
		style: "currency",
	}).format(cents / 100);
}
