/**
 * Noyau PUR de l'unité « boutique & soutien Patreon » : catalogue, prix,
 * recherche, agrégation des paliers. Aucune base, aucun réseau, aucun Discord —
 * tout est testable seul (`boutique-format.test.ts`).
 *
 * ── D'OÙ VIENT LE CATALOGUE, ET POURQUOI PAS `merch_products` ───────────────
 * La table `merch_products` existe bien en base, mais elle est VIDE, mesuré le
 * 13/8/2026 :
 *
 *   select count(*) from merch_products;                  →  0
 *   select count(*) from merch_products where is_active;  →  0
 *   select count(*) from orders;                          →  0
 *
 * Elle n'est d'ailleurs structurellement pas capable de porter la boutique : ses
 * colonnes sont `id, name, description, price, image_url, stock, is_active` —
 * pas de `slug`, donc aucun moyen de bâtir le lien vers la fiche du site, et pas
 * de variantes (taille, artiste) alors que le paiement en dépend.
 *
 * La boutique RÉELLEMENT servie sur https://rosegriffon.fr/shop est le catalogue
 * de code `apps/website/src/lib/shop/products.ts` (12 produits) : c'est lui que
 * lisent la page `/shop`, chaque fiche `/shop/<slug>`, le panier, le sitemap et
 * `/api/checkout`. Vérifié en production le 13/8/2026 :
 *
 *   GET https://rosegriffon.fr/shop/print-a5-roy-fonteneau      → 200, « 9,90 € »
 *   GET https://rosegriffon.fr/shop/tshirt-rose-griffon-edition → 200
 *
 * Le bot lit donc CE fichier, et pas une copie : une copie divergerait au
 * premier changement de prix, et Discord annoncerait un tarif que la caisse
 * refuserait. L'import est relatif parce que `apps/website` n'est pas une
 * dépendance déclarée du bot — c'est possible sans rien installer car ce module
 * du site est du TypeScript pur, sans un seul import (donc sans alias `@/`, sans
 * Next, sans React). `boutique-format.test.ts` verrouille cette hypothèse : il
 * échoue si le catalogue rétrécit, si un prix devient absurde ou si le format
 * des euros diverge de celui du site.
 */
import { CATEGORY_LABELS, PRODUCTS, type Product, type ProductCategory } from "@rosegriffon/types/shop";

/** Base publique du site, où vivent les fiches produit et les images. */
export const BASE_BOUTIQUE = "https://rosegriffon.fr";

/** Page de la campagne de soutien (cf. `apps/website/src/app/shop/layout.tsx`). */
export const URL_PATREON = "https://www.patreon.com/rosegriffon";

/** Indication de stock du catalogue, telle qu'écrite côté site. */
export type EtatStock = NonNullable<Product["stockHint"]>;

export interface VarianteProduit {
  /** Identifiant de la variante, celui attendu au paiement. */
  id: string;
  libelle: string;
  prixCents: number;
}

/** Un produit du catalogue, remis en français et prêt pour un embed. */
export interface ProduitBoutique {
  slug: string;
  nom: string;
  accroche: string;
  description: string;
  categorie: ProductCategory;
  categorieLibelle: string;
  /** Prix d'entrée, en centimes. */
  prixCents: number;
  /** Prix le plus élevé, variantes comprises. Égal à `prixCents` sans variante. */
  prixMaxCents: number;
  image: string;
  variantes: VarianteProduit[];
  points: string[];
  tags: string[];
  stock: EtatStock | null;
  exclusifPatreon: boolean;
}

function convertir(produit: Product): ProduitBoutique {
  const variantes: VarianteProduit[] = (produit.variants ?? []).map(variante => ({
    id: variante.id,
    libelle: variante.label,
    prixCents: variante.priceCentsOverride ?? produit.priceCents,
  }));
  const prix = [produit.priceCents, ...variantes.map(v => v.prixCents)];
  return {
    accroche: produit.tagline,
    categorie: produit.category,
    categorieLibelle: CATEGORY_LABELS[produit.category],
    description: produit.description,
    exclusifPatreon: produit.patreonExclusive === true,
    image: produit.image,
    nom: produit.name,
    points: [...(produit.highlights ?? [])],
    prixCents: Math.min(...prix),
    prixMaxCents: Math.max(...prix),
    slug: produit.slug,
    stock: produit.stockHint ?? null,
    tags: [...produit.tags],
    variantes,
  };
}

/** Le catalogue servi, trié par famille puis par prix croissant. */
export const CATALOGUE: readonly ProduitBoutique[] = PRODUCTS.map(convertir).toSorted(
  (a, b) => a.categorieLibelle.localeCompare(b.categorieLibelle, "fr") || a.prixCents - b.prixCents,
);

/** Familles réellement présentes dans le catalogue, dans l'ordre alphabétique français. */
export const CATEGORIES: ReadonlyArray<{ valeur: ProductCategory; libelle: string }> = [
  ...new Set(CATALOGUE.map(p => p.categorie)),
]
  .map(valeur => ({ libelle: CATEGORY_LABELS[valeur], valeur }))
  .toSorted((a, b) => a.libelle.localeCompare(b.libelle, "fr"));

/**
 * Euros à la française.
 *
 * ⚠ `Intl.NumberFormat("fr-FR")` insère une espace INSÉCABLE avant le « € », et
 * laquelle dépend de l'ICU : mesuré sous Bun 1.4 sur ce VPS, c'est U+00A0
 * (`9,90 €`), pas la fine U+202F qu'on attend souvent. Toute comparaison de
 * chaîne doit donc normaliser les blancs plutôt que parier sur un code.
 *
 * Règle des décimales alignée sur celle du site (0 décimale quand le montant
 * tombe juste), pour que Discord et la caisse affichent le même prix au
 * caractère près — `boutique-format.test.ts` compare les deux fonctions.
 */
export function formaterEuros(cents: number): string {
  const arrondi = Math.round(cents);
  return new Intl.NumberFormat("fr-FR", {
    currency: "EUR",
    minimumFractionDigits: arrondi % 100 === 0 ? 0 : 2,
    style: "currency",
  }).format(arrondi / 100);
}

/** « 24,90 € » sans variante, « de 24,90 € à 79,90 € » quand elles font varier le prix. */
export function formaterFourchettePrix(produit: ProduitBoutique): string {
  if (produit.prixMaxCents === produit.prixCents) {
    return formaterEuros(produit.prixCents);
  }
  return `de ${formaterEuros(produit.prixCents)} à ${formaterEuros(produit.prixMaxCents)}`;
}

/** Lien vers la fiche du site. */
export function urlFicheProduit(slug: string, base = BASE_BOUTIQUE): string {
  return `${base}/shop/${encodeURIComponent(slug)}`;
}

/** Les images du catalogue sont des chemins publics du site ; Discord veut une URL absolue. */
export function urlImageProduit(image: string, base = BASE_BOUTIQUE): string {
  if (/^https?:\/\//i.test(image)) return image;
  return `${base}${image.startsWith("/") ? image : `/${image}`}`;
}

/** Minuscules sans accent : la forme de comparaison des recherches. */
export function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Recherche d'autocomplétion : nom d'abord, puis accroche, famille et
 * étiquettes. Les correspondances en début de nom passent devant.
 */
export function chercherProduits(
  saisie: string | null | undefined,
  max = 25,
  catalogue: readonly ProduitBoutique[] = CATALOGUE,
): ProduitBoutique[] {
  const aiguille = normaliser(saisie ?? "");
  if (aiguille.length === 0) return catalogue.slice(0, max);

  const debuts: ProduitBoutique[] = [];
  const milieux: ProduitBoutique[] = [];
  const larges: ProduitBoutique[] = [];
  for (const produit of catalogue) {
    const nom = normaliser(produit.nom);
    if (nom.startsWith(aiguille)) {
      debuts.push(produit);
    } else if (nom.includes(aiguille) || normaliser(produit.slug).includes(aiguille)) {
      milieux.push(produit);
    } else if (
      normaliser(produit.accroche).includes(aiguille) ||
      normaliser(produit.categorieLibelle).includes(aiguille) ||
      produit.tags.some(tag => normaliser(tag).includes(aiguille))
    ) {
      larges.push(produit);
    }
  }
  return [...debuts, ...milieux, ...larges].slice(0, max);
}

/**
 * Résout ce qu'a validé le membre : l'autocomplétion propose un slug, mais rien
 * n'empêche de taper le nom du produit et d'appuyer sur Entrée.
 */
export function trouverProduit(
  reference: string | null | undefined,
  catalogue: readonly ProduitBoutique[] = CATALOGUE,
): ProduitBoutique | null {
  const brut = (reference ?? "").trim();
  if (brut.length === 0) return null;
  const exact = catalogue.find(p => p.slug === brut);
  if (exact) return exact;
  const cle = normaliser(brut);
  const parNom = catalogue.find(p => normaliser(p.nom) === cle || normaliser(p.slug) === cle);
  if (parNom) return parNom;
  return chercherProduits(brut, 1, catalogue)[0] ?? null;
}

/** Sous-ensemble du catalogue, éventuellement restreint à une famille. */
export function catalogueParCategorie(
  categorie?: string | null,
  catalogue: readonly ProduitBoutique[] = CATALOGUE,
): Array<{ categorie: ProductCategory; libelle: string; produits: ProduitBoutique[] }> {
  const filtre = categorie ? normaliser(categorie) : "";
  const groupes = new Map<ProductCategory, ProduitBoutique[]>();
  for (const produit of catalogue) {
    if (
      filtre.length > 0 &&
      normaliser(produit.categorie) !== filtre &&
      normaliser(produit.categorieLibelle) !== filtre
    ) {
      continue;
    }
    const liste = groupes.get(produit.categorie);
    if (liste) liste.push(produit);
    else groupes.set(produit.categorie, [produit]);
  }
  return [...groupes.entries()]
    .map(([valeur, produits]) => ({
      categorie: valeur,
      libelle: CATEGORY_LABELS[valeur],
      produits,
    }))
    .toSorted((a, b) => a.libelle.localeCompare(b.libelle, "fr"));
}

/* ─────────────────────────── Limites DURES de Discord ─────────────────────── */

/** Un embed ne peut pas porter plus de 25 champs. */
export const MAX_CHAMPS_EMBED = 25;
/** Ni plus de 1 024 caractères par champ. */
export const MAX_VALEUR_CHAMP = 1024;
/**
 * Ni plus de 6 000 caractères au TOTAL (titre + description + tous les champs +
 * pied). Un dépassement ne rogne rien : Discord refuse le message ENTIER, et le
 * membre reste devant « l'application n'a pas répondu ».
 */
export const MAX_TOTAL_EMBED = 6000;

export interface ChampEmbed {
  nom: string;
  valeur: string;
}

export interface ChampsCatalogue {
  champs: ChampEmbed[];
  /** Familles laissées de côté faute de place. 0 dans le cas normal. */
  omises: number;
}

/** Coupe à `max` caractères en signalant la coupe, sans dépasser d'un signe. */
function borner(texte: string, max: number): string {
  return texte.length > max ? `${texte.slice(0, max - 1).trimEnd()}…` : texte;
}

/**
 * Champs de l'embed `/boutique catalogue`, bornés par les TROIS limites d'un
 * coup : 25 champs, 1 024 caractères par champ, 6 000 au total.
 *
 * Les 12 produits d'aujourd'hui tiennent en 1 581 caractères (mesuré le
 * 13/8/2026), très loin des 6 000 : ce plafond n'est pas là pour le catalogue
 * actuel mais pour le suivant. Le catalogue vit dans le code du site, il grossit
 * sans que personne ne repasse par ici, et le jour où la somme franchit 6 000 la
 * commande ne rendrait pas une liste tronquée — elle ne rendrait plus RIEN.
 * `omises` permet à l'appelant de le dire au lieu de mentir par omission.
 */
export function champsCatalogue(
  groupes: ReadonlyArray<{ libelle: string; produits: readonly ProduitBoutique[] }>,
  budget: number,
  base = BASE_BOUTIQUE,
): ChampsCatalogue {
  const champs: ChampEmbed[] = [];
  let reste = Math.max(0, budget);
  let omises = 0;

  for (const groupe of groupes) {
    const nom = `${groupe.libelle} (${groupe.produits.length})`;
    const valeur = borner(groupe.produits.map(produit => ligneCatalogue(produit, base)).join("\n"), MAX_VALEUR_CHAMP);
    const cout = nom.length + valeur.length;
    if (champs.length >= MAX_CHAMPS_EMBED || cout > reste) {
      omises += 1;
      continue;
    }
    reste -= cout;
    champs.push({ nom, valeur });
  }
  return { champs, omises };
}

const LIBELLES_STOCK: Record<EtatStock, string> = {
  "in-stock": "En stock",
  limited: "Édition limitée",
  "low-stock": "Derniers exemplaires",
  preorder: "Précommande",
};

export function libelleStock(stock: EtatStock | null | undefined): string | null {
  return stock ? LIBELLES_STOCK[stock] : null;
}

/** Une ligne de liste : « [Nom](url) — 9,90 € · En stock ». */
export function ligneCatalogue(produit: ProduitBoutique, base = BASE_BOUTIQUE): string {
  const details = [formaterFourchettePrix(produit), libelleStock(produit.stock)]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" · ");
  return `[${produit.nom}](${urlFicheProduit(produit.slug, base)}) — ${details}`;
}

/* ────────────────────────────── Soutien Patreon ───────────────────────────── */

/**
 * Statuts renvoyés par l'API Patreon et stockés dans
 * `patreon_memberships.patron_status`. Relevé du 13/8/2026 :
 *
 *   active_patron  3   (palier « 𝙽𝚒𝚟𝚎𝚊𝚞 𝙴𝚟𝚊𝚗𝚜 🌹 », 14,50 €)
 *   former_patron  4   (palier « Free »)
 *   NULL           4   (abonné sans engagement — « Free » aussi)
 *
 * `patreon_legacy_tiers` et `patreon_legacy_members`, qui décriraient les
 * paliers hérités, sont VIDES (0 ligne chacune, mesuré le 13/8/2026) : les
 * paliers affichés sont donc reconstruits depuis les colonnes tableau
 * `tier_titles` / `tier_amounts_cents` de `patreon_memberships`, seule source
 * qui contienne réellement quelque chose.
 */
export type StatutPatron = "actif" | "refuse" | "ancien" | "abonne";

export function classerStatutPatron(brut: string | null | undefined): StatutPatron {
  switch ((brut ?? "").trim().toLowerCase()) {
    case "active_patron":
      return "actif";
    case "declined_patron":
      return "refuse";
    case "former_patron":
      return "ancien";
    default:
      return "abonne";
  }
}

const LIBELLES_STATUT: Record<StatutPatron, string> = {
  abonne: "Abonné sans engagement",
  actif: "Soutien actif",
  ancien: "Ancien soutien",
  refuse: "Paiement refusé",
};

export function libelleStatutPatron(statut: StatutPatron): string {
  return LIBELLES_STATUT[statut];
}

/** Une ligne de `patreon_memberships`, réduite à ce qui n'est PAS une donnée personnelle. */
export interface AdhesionPatreon {
  patron_status: string | null;
  tier_titles: string[] | null;
  tier_amounts_cents: Array<number | string> | null;
  currently_entitled_cents: number | string | null;
  lifetime_support_cents: number | string | null;
  pledge_cadence: number | null;
  pledge_start: Date | string | null;
  next_charge_date: Date | string | null;
  last_charge_status: string | null;
  last_charge_date: Date | string | null;
  is_free_trial: boolean | null;
  is_gifted: boolean | null;
}

export interface PalierAgrege {
  titre: string;
  /** Montant mensuel du palier, en centimes. `null` si le palier n'en déclare aucun. */
  montantCents: number | null;
  soutiens: number;
}

/** `bigint` Postgres arrive en chaîne côté Bun.SQL : on ne suppose ni l'un ni l'autre. */
function nombre(valeur: number | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null;
  const n = typeof valeur === "number" ? valeur : Number(valeur);
  return Number.isFinite(n) ? n : null;
}

/**
 * Décompte AGRÉGÉ des soutiens par palier. Ne regarde que les adhésions
 * actives : un ancien soutien n'occupe plus son palier. Aucune identité n'entre
 * ni ne sort de cette fonction.
 */
export function agregerPaliers(lignes: readonly AdhesionPatreon[]): PalierAgrege[] {
  const paliers = new Map<string, PalierAgrege>();
  for (const ligne of lignes) {
    if (classerStatutPatron(ligne.patron_status) !== "actif") continue;
    const titres = ligne.tier_titles ?? [];
    const montants = ligne.tier_amounts_cents ?? [];
    for (const [index, titreBrut] of titres.entries()) {
      const titre = (titreBrut ?? "").trim();
      if (titre.length === 0) continue;
      const existant = paliers.get(titre);
      const montant = nombre(montants[index]);
      if (existant) {
        existant.soutiens += 1;
        if (existant.montantCents === null) existant.montantCents = montant;
      } else {
        paliers.set(titre, { montantCents: montant, soutiens: 1, titre });
      }
    }
  }
  return [...paliers.values()].toSorted(
    (a, b) => (b.montantCents ?? 0) - (a.montantCents ?? 0) || b.soutiens - a.soutiens,
  );
}

/** Décompte par statut, tous paliers confondus. */
export function compterParStatut(lignes: readonly AdhesionPatreon[]): Record<StatutPatron, number> {
  const total: Record<StatutPatron, number> = { abonne: 0, actif: 0, ancien: 0, refuse: 0 };
  for (const ligne of lignes) {
    total[classerStatutPatron(ligne.patron_status)] += 1;
  }
  return total;
}

/** « 3 soutiens » / « 1 soutien » / « aucun soutien ». */
export function accorderSoutiens(nombreDeSoutiens: number): string {
  if (nombreDeSoutiens <= 0) return "aucun soutien";
  return nombreDeSoutiens === 1 ? "1 soutien" : `${nombreDeSoutiens} soutiens`;
}

/** Ligne d'un palier dans l'embed public : « **Palier** — 3 soutiens · 14,50 €/mois ». */
export function lignePalier(palier: PalierAgrege): string {
  const montant =
    palier.montantCents !== null && palier.montantCents > 0 ? ` · ${formaterEuros(palier.montantCents)}/mois` : "";
  return `**${palier.titre}** — ${accorderSoutiens(palier.soutiens)}${montant}`;
}

/** Cadence de prélèvement Patreon : 1 = par mois, 12 = par an. */
export function formaterCadence(cadence: number | null | undefined): string | null {
  if (cadence === 1) return "mensuel";
  if (cadence === 12) return "annuel";
  return null;
}

/**
 * Date seule, en français. Les heures n'apportent rien à une date d'échéance.
 * Le fuseau est FIXÉ à Europe/Paris : l'hôte tourne en UTC, et une date de
 * prélèvement stockée à minuit basculerait d'un jour selon la machine.
 */
export function formaterDateFr(valeur: Date | string | null | undefined): string | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    timeZone: "Europe/Paris",
    year: "numeric",
  });
}

/**
 * Issue du dernier prélèvement, telle que renvoyée par l'API Patreon dans
 * `last_charge_status`. Relevé en base le 13/8/2026 : seule « Paid » est
 * présente ; les autres valeurs documentées par Patreon sont traduites d'avance
 * plutôt que d'attendre qu'un membre lise un mot anglais. Une valeur inconnue
 * est rendue telle quelle, jamais masquée.
 */
const LIBELLES_PRELEVEMENT: Record<string, string> = {
  declined: "refusé",
  deleted: "supprimé",
  fraud: "signalé en fraude",
  other: "autre",
  paid: "réglé",
  pending: "en attente",
  refunded: "remboursé",
};

export function libellePrelevement(brut: string | null | undefined): string | null {
  const valeur = (brut ?? "").trim();
  if (valeur.length === 0) return null;
  return LIBELLES_PRELEVEMENT[valeur.toLowerCase()] ?? valeur;
}

/** Titres des paliers d'une adhésion, mis en forme. */
export function paliersDeLAdhesion(ligne: AdhesionPatreon): string {
  const titres = (ligne.tier_titles ?? []).map(t => (t ?? "").trim()).filter(t => t.length > 0);
  return titres.length > 0 ? titres.join(" · ") : "Aucun palier";
}

/**
 * Fiche personnelle d'un soutien, prête à afficher. N'est appelée que pour la
 * personne elle-même, en réponse éphémère : ni e-mail, ni nom, ni adresse
 * postale ne figurent dans le type `AdhesionPatreon`, donc rien de tout cela ne
 * peut fuir ici.
 */
export function resumerAdhesion(ligne: AdhesionPatreon): Array<{ nom: string; valeur: string }> {
  const champs: Array<{ nom: string; valeur: string }> = [];
  const statut = classerStatutPatron(ligne.patron_status);
  const cadence = formaterCadence(ligne.pledge_cadence);

  champs.push({
    nom: "Statut",
    valeur: [
      libelleStatutPatron(statut),
      ligne.is_free_trial === true ? "essai gratuit" : null,
      ligne.is_gifted === true ? "abonnement offert" : null,
    ]
      .filter((v): v is string => typeof v === "string")
      .join(" · "),
  });
  champs.push({ nom: "Palier", valeur: paliersDeLAdhesion(ligne) });

  const engage = nombre(ligne.currently_entitled_cents);
  if (engage !== null && engage > 0) {
    champs.push({
      nom: "Engagement en cours",
      valeur: `${formaterEuros(engage)}${cadence ? ` (${cadence})` : ""}`,
    });
  }
  const cumul = nombre(ligne.lifetime_support_cents);
  if (cumul !== null && cumul > 0) {
    champs.push({ nom: "Soutien cumulé", valeur: formaterEuros(cumul) });
  }

  const debut = formaterDateFr(ligne.pledge_start);
  if (debut) champs.push({ nom: "Depuis le", valeur: debut });

  const prochain = formaterDateFr(ligne.next_charge_date);
  if (prochain && statut === "actif") {
    champs.push({ nom: "Prochain prélèvement", valeur: prochain });
  }

  const dernier = formaterDateFr(ligne.last_charge_date);
  const issue = libellePrelevement(ligne.last_charge_status);
  if (dernier || issue) {
    champs.push({
      nom: "Dernier prélèvement",
      valeur: [dernier, issue].filter((v): v is string => typeof v === "string").join(" · "),
    });
  }
  return champs;
}
