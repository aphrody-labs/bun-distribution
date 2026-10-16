/**
 * `/azalee` — les fiches de jeu d'Inazuma Eleven: Victory Road dans Discord.
 *
 * Remplace l'ancien `/ievr`, dont les cinq sous-commandes (personnage,
 * technique, objet, équipe, recherche transverse) sont reprises ici sans perte,
 * et couvre en plus les quatorze sections du wiki qui n'étaient atteignables
 * qu'au navigateur : aura, tactique, passif, quête, entraîneur, stade, succès,
 * capsule, costume, invocation, drops, magasin, galerie, coordinateur.
 *
 * **19 sous-commandes** — Discord en plafonne 25 par groupe, la marge est donc
 * de six. Toute nouvelle fiche doit tenir dans ce budget.
 *
 * Toute la lecture passe par `@rosegriffon/azalee` (client HTTP typé du
 * sous-chemin `/remote`, cf. `lib/azalee.ts` pour la raison de ne PAS ouvrir le
 * miroir SQLite depuis le bot).
 *
 * ⚠ TROIS FILTRES DE L'API SONT INOPÉRANTS (mesuré le 13/8/2026, hors de la
 * portée de ce fichier — `packages/azalee/src/wiki/`) : `/api/quests?q=` et
 * `?kind=` ainsi que `/api/trophies?q=` et `?category=` renvoient les 182 et
 * 228 lignes quoi qu'on demande. Ces deux routes servant l'intégralité de leur
 * table en une réponse, on filtre ICI, en mémoire et sous cache — un filtre qui
 * ne filtre pas est plus trompeur qu'un filtre absent.
 *
 * ⚠ PIÈGE `inagle_skills` : `category_id` et `element_id` sont à NULL en base.
 * Les filtres passent donc par les colonnes TEXTE françaises, via
 * `lib/ievr-labels.ts`. Une commande qui filtrerait sur l'identifiant ne
 * renverrait jamais rien. Vérifié sur les tables exposées ici : `inagle_teams`,
 * `inagle_items` et `inagle_characters` n'ont pas le même défaut (les filtres
 * `element`/`position` de `/api/characters` traduisent d'ailleurs eux-mêmes le
 * code anglais vers le texte français avant d'interroger la base).
 *
 * Les vues ci-dessous re-déclarent le strict nécessaire des réponses de l'API :
 * les types de `@rosegriffon/azalee/remote` sont dérivés des fonctions serveur
 * et exposent bien plus large que ce qu'un embed affiche.
 */
import { ButtonComponent, Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { dropCategoryLabel, dropSourceLabel } from "@rosegriffon/azalee/wiki/drops-shared";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
  MessageFlags,
} from "discord.js";

import { azalee, isAzaleeNotFound, messageErreurAzalee, urlWiki } from "../lib/azalee";
import {
  bornerPage,
  CATEGORIES_GALERIE,
  cheminCpkDepuisUrl,
  classerPropositions,
  decoderEtatListe,
  decouperEnChamps,
  encoderEtatListe,
  type EtatListeAzalee,
  formaterNombre,
  formaterPourcentage,
  imageJeu,
  joindre,
  libelleCategorieGalerie,
  libelleCategorieSucces,
  libelleGenreQuete,
  libelleRoleCoordinateur,
  libelleTypeAura,
  ligneStats,
  type Multilingue,
  nettoyerRubis,
  nettoyerTexteJeu,
  nombreDePages,
  resoudreCategorieGalerie,
  resoudreTypeAura,
  type SlugAura,
  type Statistiques,
  texteFr,
  TYPES_AURA,
  urlIllustrationQuete,
  urlModele3d,
  urlVisage,
  couleurElement,
} from "../lib/azalee-format";
import { cached } from "../lib/cache";
import { rgEmbed, truncate } from "../lib/embeds";
import {
  CATEGORIES_TECHNIQUE_FR,
  ELEMENTS_FR,
  iconeElementUrl,
  libelleCategorieObjet,
  RARETES_FR,
  resoudreCategorieTechnique,
  resoudreElement,
  resoudreRarete,
  suggerer,
} from "../lib/ievr-labels";
import { echec, pied, repondre } from "../lib/ui";

// --- Vues des réponses de l'API -------------------------------------------

interface TechniqueApprise {
  skillId?: string | null;
  learnLevel?: number | null;
}

interface VariantePerso {
  charaParamId?: string | null;
  internalCode?: string | null;
  position?: string | null;
  element?: string | null;
  rarity?: string | null;
  stats?: { lv99?: Statistiques | null } | null;
  skills?: TechniqueApprise[] | null;
  image?: string | null;
}

interface FichePerso {
  names?: Multilingue;
  descriptions?: Multilingue;
  variants?: VariantePerso[];
  bestRarity?: string | null;
  baseSlug?: string | null;
  slug?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  series?: string | null;
  internalCode?: string | null;
  image?: string | null;
  constellation?: { index?: number | null; names?: Multilingue | null } | null;
}

interface FicheTechnique {
  skillId?: string | null;
  internalCode?: string | null;
  names?: Multilingue;
  descriptions?: Multilingue;
  displayName?: string | null;
  categoryName?: Multilingue | null;
  elementName?: Multilingue | null;
  skillType?: string | null;
  powerRange?: string | null;
  consumeTp?: number | null;
  recastTime?: number | null;
  growthSpeed?: string | null;
  videoUrl?: string | null;
  image?: string | null;
  shops?: { fr?: string[] | null } | null;
}

interface FicheObjet {
  itemId?: string | null;
  internalCode?: string | null;
  names?: Multilingue;
  descriptions?: Multilingue;
  category?: string | null;
  price?: number | null;
  /**
   * ⚠ TOUJOURS `null` : mesuré sur 200 des 1 668 objets, `stats` n'est jamais
   * peuplé. Les bonus chiffrés vivent dans `bonuses` (35 objets sur 200).
   * Le champ reste déclaré parce que l'API le sert, mais on lit `bonuses`.
   */
  stats?: Statistiques | null;
  bonuses?: Statistiques | null;
  shops?: { fr?: string[] | null } | null;
  image?: string | null;
}

interface EntreeEquipe {
  id?: string | null;
  name?: string | null;
  nameEn?: string | null;
  nameJa?: string | null;
  rosterCount?: number | null;
}

interface JoueurEffectif {
  name?: string | null;
  position?: string | null;
  element?: string | null;
}

interface FicheEquipe extends EntreeEquipe {
  descriptionFr?: string | null;
  descriptionEn?: string | null;
  emblemUrl?: string | null;
  seasons?: Record<string, number> | null;
  roster?: JoueurEffectif[] | null;
}

interface ResultatRecherche {
  characters?: FichePerso[];
  skills?: FicheTechnique[];
  items?: FicheObjet[];
}

/** Enveloppe des routes de liste paginées (`{data, total, page, limit}`). */
interface Page<T> {
  data?: T[] | null;
  total?: number | null;
}

interface EntreeAura {
  id?: string | null;
  name?: string | null;
  element?: string | null;
  type?: string | null;
  hissatsu_name?: string | null;
}

interface HissatsuAura {
  name?: string | null;
  type?: string | null;
  element?: string | null;
  power?: { min?: number | null; max?: number | null } | null;
}

interface FicheAura {
  auraId?: string | null;
  displayName?: string | null;
  name_FR?: string | null;
  name_EN?: string | null;
  name_JA?: string | null;
  desc_FR?: string | null;
  desc_JA?: string | null;
  elementName?: Multilingue | null;
  image?: string | null;
  telopUrl?: string | null;
  assetCode?: string | null;
  subType?: string | null;
  sheetData?: { hissatsu?: HissatsuAura | null; config?: Record<string, unknown> | null } | null;
}

interface EntreeTactique {
  itemId?: string | null;
  names?: Multilingue;
  category?: string | null;
  rarity?: number | null;
}

interface FicheTactique {
  slug?: string | null;
  name_fr?: string | null;
  name?: string | null;
  name_ja?: string | null;
  description_fr?: string | null;
  description_en?: string | null;
  effect1?: string | null;
  effect2?: string | null;
  effect3?: string | null;
  duration?: number | null;
  cooldown?: number | null;
  shop?: string | null;
  internalCode?: string | null;
  element?: string | null;
  power?: number | null;
  partnerCount?: number | null;
  image?: string | null;
}

interface FichePassif {
  passive_id?: string | null;
  string_id?: string | null;
  name?: Multilingue | null;
  description?: Multilingue | null;
  text_raw?: Multilingue | null;
  element_name?: string | null;
  rarity?: number | null;
  main_value?: number | null;
  effect_id?: string | null;
  effect_params?: number[] | null;
}

interface FicheQuete {
  id?: string | null;
  title?: string | null;
  titles?: Multilingue;
  kind?: string | null;
  type?: number | null;
  phase?: number | null;
  image?: string | null;
  area?: string | null;
}

interface ListeQuetes {
  quests?: FicheQuete[] | null;
  total?: number | null;
  main?: number | null;
  side?: number | null;
}

interface FicheEntraineur {
  id?: number | null;
  name?: string | null;
  nameKanji?: string | null;
  nameRomaji?: string | null;
  internalCode?: string | null;
  image?: string | null;
  roleFr?: string | null;
  playstyleFr?: string | null;
  elementFr?: string | null;
  stat?: string | null;
  buff?: string | null;
  requirements?: string | null;
  scaling?: {
    coordCommon?: string | null;
    coordLegendary?: string | null;
    managerCommon?: string | null;
    managerLegendary?: string | null;
  } | null;
}

interface FicheStade {
  id?: string | null;
  code?: string | null;
  title?: string | null;
  index?: number | null;
  image?: string | null;
}

interface FicheSucces {
  id?: string | null;
  category?: string | null;
  groupLabel?: string | null;
  name?: string | null;
  desc?: string | null;
  names?: Multilingue;
  descriptions?: Multilingue;
}

interface ListeSucces {
  trophies?: FicheSucces[] | null;
  total?: number | null;
  counts?: Record<string, number> | null;
}

interface LotCapsule {
  id?: string | null;
  contentRef?: string | null;
  poolRef?: string | null;
  extraFlag?: number | null;
}

interface ListeCapsules extends Page<LotCapsule> {
  pools?: Array<{ ref?: string | null; count?: number | null }> | null;
}

interface Costume {
  id?: string | null;
  index?: number | null;
  typeLabel?: string | null;
  modelRef?: string | null;
}

interface ListeCostumes extends Page<Costume> {
  types?: Array<{ type?: number | null; label?: string | null; count?: number | null }> | null;
}

interface SigneInvocation {
  signNo?: number | null;
  name?: string | null;
  totalChars?: number | null;
  tiers?: Array<{
    label?: string | null;
    ratePct?: number | null;
    count?: number | null;
    perCharPct?: number | null;
  }> | null;
}

interface EntreeDrop {
  id?: string | null;
  source?: string | null;
  itemName?: string | null;
  itemCategory?: string | null;
  itemInternalCode?: string | null;
  chance?: number | null;
  weight?: number | null;
}

interface DonneesDrops {
  drops?: EntreeDrop[] | null;
  counts?: Record<string, number> | null;
  categories?: string[] | null;
  beanGames?: string[] | null;
  beans?: Array<{ team?: string | null; stat?: string | null; value?: string | null }> | null;
  spiritGroups?: Array<{ anyChance?: number | null }> | null;
}

interface EntreeMagasin {
  shopId?: number | null;
  name?: string | null;
  nameEn?: string | null;
  nameJa?: string | null;
  itemCount?: number | null;
  categories?: Array<{ category?: string | null; count?: number | null }> | null;
}

interface FicheMagasin extends EntreeMagasin {
  items?: Array<{ name?: string | null; category?: string | null }> | null;
}

interface EntreeGalerie {
  id?: string | null;
  imgPath?: string | null;
  category?: string | null;
  title?: string | null;
  image?: string | null;
}

// --- Socle partagé avec `azalee-monde.ts` ---------------------------------

/**
 * Réponse d'autocomplétion tolérante : une API muette ne doit pas figer la saisie.
 *
 * Discord n'accorde que 3 secondes ; au-delà, le champ reste bloqué sur
 * « chargement… ». On répond donc TOUJOURS, quitte à répondre une liste vide.
 */
export async function repondreSuggestions(
  interaction: AutocompleteInteraction,
  produire: () => Promise<Array<{ name: string; value: string }>>,
): Promise<void> {
  try {
    const choix = await produire();
    await interaction.respond(
      choix
        .filter(c => c.value.length > 0)
        .slice(0, 25)
        .map(c => ({ name: truncate(c.name, 100), value: truncate(c.value, 100) })),
    );
  } catch {
    await interaction.respond([]);
  }
}

/** Saisie courante de l'option en cours d'autocomplétion. */
export function saisie(interaction: AutocompleteInteraction): string {
  const valeur = interaction.options.getFocused();
  return typeof valeur === "string" ? valeur : String(valeur ?? "");
}

/**
 * Ouvre une fiche par identifiant, avec REPLI PAR RECHERCHE sur le nom.
 *
 * L'autocomplétion Discord n'est qu'une suggestion : rien n'empêche de taper le
 * nom et de valider. Or `/api/characters/<id>` n'accepte qu'un slug — mesuré :
 * `perso « Mark Evans »` répondait « Introuvable dans le wiki » alors que
 * `?q=Mark Evans` renvoie exactement une ligne. Un membre qui écrit le vrai nom
 * d'un personnage ne doit pas s'entendre dire qu'il n'existe pas.
 *
 * L'ordre compte : l'identifiant d'abord (exact, une requête), la recherche
 * seulement en repli sur un 404 — jamais l'inverse, pour ne pas transformer un
 * slug valide en « meilleur résultat approchant ».
 */
export async function ouvrirFiche<T>(
  parIdentifiant: (cle: string) => Promise<T>,
  parRecherche: (texte: string) => Promise<string | null>,
  saisieBrute: string,
): Promise<T> {
  try {
    return await parIdentifiant(saisieBrute);
  } catch (err) {
    if (!isAzaleeNotFound(err)) {
      throw err;
    }
    const cle = await parRecherche(saisieBrute);
    if (!cle) {
      throw err;
    }
    return await parIdentifiant(cle);
  }
}

/**
 * Illustration dont l'existence est PROUVÉE avant de la poser dans un embed.
 *
 * `imageJeu` répare les chemins hérités du dump, mais certaines URL restent
 * fausses au cas par cas (icône Miximax `iau0016a` absente des CPK, personnage
 * sans visage extrait…). Un embed Discord n'a pas d'`onError` : on demande donc
 * à l'index CPK — 250 800 fichiers, la même source que le décodeur du CDN — si
 * le fichier source existe, et on n'affiche rien sinon.
 *
 * Le verdict est mis en cache 6 h : l'index ne bouge qu'à une mise à jour du jeu.
 * Une URL hors CPK (portrait CloudFront) est renvoyée telle quelle, sans appel.
 */
export async function illustrationProuvee(
  url: string | null | undefined,
  largeur?: 200 | 400 | 800 | 1600,
): Promise<string | null> {
  const image = imageJeu(url, largeur);
  if (!image) {
    return null;
  }
  const chemin = cheminCpkDepuisUrl(image);
  if (!chemin) {
    return image;
  }
  const existe = await cached<boolean>(`azalee:cpk:${chemin}`, 6 * 60 * 60_000, async () => {
    try {
      await azalee().cpkFile(chemin);
      return true;
    } catch {
      return false;
    }
  });
  return existe ? image : null;
}

/** Équipes du wiki, en cache court : 208 lignes, servies à chaque fiche de personnage. */
export async function equipesConnues(): Promise<EntreeEquipe[]> {
  return await cached<EntreeEquipe[]>("azalee:equipes", 10 * 60_000, async () => {
    const equipes = (await azalee().teams()) as unknown as EntreeEquipe[];
    return equipes.map(equipe => ({
      id: equipe.id ?? null,
      name: equipe.name ?? null,
      nameEn: equipe.nameEn ?? null,
      nameJa: equipe.nameJa ?? null,
      rosterCount: equipe.rosterCount ?? null,
    }));
  });
}

/**
 * Nom d'équipe d'un personnage.
 *
 * `inagle_characters.teams` est NULL sur les 6 148 lignes, donc `teamName` que
 * renvoie l'API est TOUJOURS la chaîne vide — le champ « Équipe » ne pouvait
 * jamais s'afficher. `team_id`, lui, est peuplé et `/api/teams` résout les 208
 * noms : on fait la jointure ici.
 */
async function nomEquipe(perso: FichePerso): Promise<string | null> {
  const direct = perso.teamName?.trim();
  if (direct) {
    return direct;
  }
  if (!perso.teamId) {
    return null;
  }
  try {
    const equipes = await equipesConnues();
    const equipe = equipes.find(e => String(e.id) === String(perso.teamId));
    return equipe?.name ?? equipe?.nameEn ?? null;
  } catch {
    // Une jointure décorative ne fait pas échouer une fiche.
    return null;
  }
}

/**
 * Somme des sept statistiques niveau 99 d'une variante — critère de « meilleure ».
 *
 * ⚠ `bestRarity` de l'API n'est PAS la meilleure variante : c'est la PLUS JEUNE
 * (`service.ts` → `youngest.rarity`). Mark Evans sortait ainsi en « Normal »
 * (Frappe 133) alors qu'il a des variantes bien supérieures. On classe donc sur
 * la donnée chiffrée, pas sur une étiquette.
 */
function totalStats(variante: VariantePerso): number {
  const stats = variante.stats?.lv99;
  if (!stats) {
    return -1;
  }
  return Object.values(stats).reduce<number>((somme, valeur) => somme + (typeof valeur === "number" ? valeur : 0), 0);
}

/** Nom français d'une technique apprise, résolu par son identifiant hexadécimal. */
async function nomTechnique(skillId: string): Promise<string | null> {
  return await cached<string | null>(`azalee:skill-nom:${skillId}`, 30 * 60_000, async () => {
    try {
      const technique = (await azalee().skill(skillId)) as unknown as FicheTechnique;
      return texteFr(technique.names, technique.displayName ?? "") || null;
    } catch {
      return null;
    }
  });
}

// --- Tables servies EN ENTIER par l'API, donc filtrées et paginées ici ------

/**
 * Les 182 quêtes. `/api/quests` ignore `q` et `kind` (mesuré : 182 quel que soit
 * le filtre) mais sert la table entière en une réponse — on la garde 10 min et
 * on filtre en mémoire.
 */
async function quetesConnues(): Promise<FicheQuete[]> {
  return await cached<FicheQuete[]>("azalee:quetes", 10 * 60_000, async () => {
    const liste = (await azalee().quests()) as unknown as ListeQuetes;
    return liste.quests ?? [];
  });
}

/** Les 228 succès. Même défaut de filtre côté API que les quêtes, même parade. */
async function succesConnus(): Promise<FicheSucces[]> {
  return await cached<FicheSucces[]>("azalee:succes", 10 * 60_000, async () => {
    const liste = (await azalee().trophies()) as unknown as ListeSucces;
    return liste.trophies ?? [];
  });
}

/** Les 81 stades. `?q=` fonctionne côté API, mais 81 lignes tiennent en cache. */
async function stadesConnus(): Promise<FicheStade[]> {
  return await cached<FicheStade[]>("azalee:stades", 10 * 60_000, async () => {
    const liste = (await azalee().stadiums()) as unknown as Page<FicheStade>;
    return liste.data ?? [];
  });
}

/** Les 15 magasins, avec leur ventilation par catégorie. */
async function magasinsConnus(): Promise<EntreeMagasin[]> {
  return await cached<EntreeMagasin[]>(
    "azalee:magasins",
    10 * 60_000,
    async () => ((await azalee().shops()) ?? []) as unknown as EntreeMagasin[],
  );
}

/** Les 102 entraîneurs / coordinateurs de la table `inagle_coaches`. */
async function entraineursConnus(): Promise<FicheEntraineur[]> {
  return await cached<FicheEntraineur[]>(
    "azalee:entraineurs",
    10 * 60_000,
    async () => ((await azalee().coaches()) ?? []) as unknown as FicheEntraineur[],
  );
}

/** Les 30 signes d'invocation et leurs taux. */
async function signesInvocation(): Promise<SigneInvocation[]> {
  return await cached<SigneInvocation[]>(
    "azalee:invocation",
    30 * 60_000,
    async () => ((await azalee().invocation()) ?? []) as unknown as SigneInvocation[],
  );
}

/** Toutes les données de drops (123 lots concrets, 19 groupes d'esprits, 98 fèves). */
async function donneesDrops(): Promise<DonneesDrops> {
  return await cached<DonneesDrops>(
    "azalee:drops",
    30 * 60_000,
    async () => (await azalee().drops()) as unknown as DonneesDrops,
  );
}

// --- Listes fermées d'options ----------------------------------------------

/** Les deux seuls genres de quête présents en base : 137 `main`, 45 `side`. */
const CHOIX_GENRE_QUETE = [
  { name: "Quête principale", value: "main" },
  { name: "Quête annexe", value: "side" },
] as const;

/** Les deux seules catégories de succès présentes en base : 52 trophées, 176 activités. */
const CHOIX_CATEGORIE_SUCCES = [
  { name: "Trophée", value: "trophy" },
  { name: "Activité", value: "activity" },
] as const;

/**
 * Les deux seules sources de drop concret servies par `/api/drops`
 * (`SUPPORTED_CONCRETE_SOURCES` de `packages/azalee/src/wiki/drops.ts`).
 * Les libellés viennent de `dropSourceLabel`, pas d'une traduction maison.
 */
const CHOIX_SOURCE_DROP = [
  { name: dropSourceLabel("win_treasure"), value: "win_treasure" },
  { name: dropSourceLabel("item_emission"), value: "item_emission" },
] as const;

// --- Listes paginées par boutons -------------------------------------------

/** Nombre d'entrées par page des vues à boutons. */
const PAR_PAGE = 8;

/**
 * Boutons « Précédent / n sur N / Suivant ».
 *
 * `encoderEtatListe` renvoie `null` au-delà des 100 caractères de `customId` :
 * dans ce cas on n'affiche AUCUN bouton plutôt que d'envoyer un composant que
 * Discord refuserait — un refus fait échouer le message entier, embed compris.
 */
function boutonsPagination(etat: EtatListeAzalee, page: number, pages: number): Array<ActionRowBuilder<ButtonBuilder>> {
  const idPrecedent = encoderEtatListe({ ...etat, page: page - 1 });
  const idSuivant = encoderEtatListe({ ...etat, page: page + 1 });
  if (pages <= 1 || !idPrecedent || !idSuivant) {
    return [];
  }
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(idPrecedent)
        .setLabel("Précédent")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      // Repère de position, jamais cliquable : sur mobile le pied de l'embed
      // se lit mal, et sans lui on ignore où l'on est dans 168 pages.
      new ButtonBuilder()
        .setCustomId("az-repere")
        .setLabel(`${page} / ${pages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(idSuivant)
        .setLabel("Suivant")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages),
    ),
  ];
}

/** Page de la galerie d'illustrations : `/api/gallery` pagine côté serveur. */
async function rendreGalerie(etat: EtatListeAzalee): Promise<InteractionEditReplyOptions> {
  const categorie = resoudreCategorieGalerie(etat.filtre);
  const parametres = {
    page: Math.max(1, etat.page),
    limit: PAR_PAGE,
    ...(categorie ? { category: categorie } : {}),
    ...(etat.recherche ? { q: etat.recherche } : {}),
  };
  const premier = (await azalee().gallery(parametres as never)) as unknown as Page<EntreeGalerie>;
  const total = premier.total ?? 0;
  // Une page au-delà de la dernière ne doit pas répondre « vide » : on la
  // ramène dans les bornes et on relit.
  const page = bornerPage(etat.page, total, PAR_PAGE);
  const resultat =
    page === parametres.page
      ? premier
      : ((await azalee().gallery({
          ...parametres,
          page,
        } as never)) as unknown as Page<EntreeGalerie>);
  const entrees = resultat.data ?? [];
  const pages = nombreDePages(total, PAR_PAGE);

  const embed = rgEmbed()
    .setTitle(`Galerie — ${formaterNombre(total)} illustration${total > 1 ? "s" : ""}`)
    .setURL(urlWiki(categorie ? `/gallery?category=${categorie}` : "/gallery"));
  const criteres = joindre([
    categorie ? libelleCategorieGalerie(categorie) : null,
    etat.recherche ? `« ${etat.recherche} »` : null,
  ]);
  if (criteres.length > 0) {
    embed.setAuthor({ name: truncate(`Filtres : ${criteres}`, 200) });
  }

  if (entrees.length === 0) {
    embed.setDescription(
      criteres.length > 0
        ? "Aucune illustration ne correspond à ces filtres."
        : "La galerie ne contient aucune illustration.",
    );
  } else {
    const lignes = entrees.map(entree => {
      const lien = imageJeu(entree.image, 1600);
      const titre = truncate(String(entree.title ?? entree.imgPath ?? "Illustration"), 70);
      const etiquette = libelleCategorieGalerie(entree.category);
      return lien ? `**${titre}** · ${etiquette} — [voir](${lien})` : `**${titre}** · ${etiquette}`;
    });
    embed.setDescription(truncate(lignes.join("\n"), 3800));
    // Une seule vignette : les huit illustrations de la page coûteraient huit
    // décodages CPK, et Discord n'affiche de toute façon qu'une image par embed.
    const apercu = await illustrationProuvee(entrees[0]?.image, 800);
    if (apercu) {
      embed.setImage(apercu);
    }
  }
  pied(embed, { page: page, pages: pages });
  return { embeds: [embed], components: boutonsPagination(etat, page, pages) };
}

/** Page des taux de drop : `/api/drops` sert tout, la pagination est en mémoire. */
async function rendreDrops(etat: EtatListeAzalee): Promise<InteractionEditReplyOptions> {
  const donnees = await donneesDrops();
  const tous = donnees.drops ?? [];
  const filtres = tous.filter(drop => {
    if (etat.filtre && drop.source !== etat.filtre) {
      return false;
    }
    if (!etat.recherche) {
      return true;
    }
    const aiguille = etat.recherche.toLowerCase();
    return `${drop.itemName ?? ""} ${drop.itemInternalCode ?? ""}`.toLowerCase().includes(aiguille);
  });
  const page = bornerPage(etat.page, filtres.length, PAR_PAGE);
  const pages = nombreDePages(filtres.length, PAR_PAGE);
  const tranche = filtres.slice((page - 1) * PAR_PAGE, page * PAR_PAGE);

  const compteurs = donnees.counts ?? {};
  const embed = rgEmbed()
    .setTitle(`Taux de drop — ${formaterNombre(filtres.length)} lot${filtres.length > 1 ? "s" : ""}`)
    .setURL(urlWiki("/drops"));
  if (etat.filtre || etat.recherche) {
    embed.setAuthor({
      name: truncate(
        `Filtres : ${joindre([
          etat.filtre ? dropSourceLabel(etat.filtre as never) : null,
          etat.recherche ? `« ${etat.recherche} »` : null,
        ])}`,
        200,
      ),
    });
  }

  if (tranche.length === 0) {
    embed.setDescription("Aucun lot ne correspond à ces filtres.");
  } else {
    embed.setDescription(
      truncate(
        tranche
          .map(
            drop =>
              `**${truncate(String(drop.itemName ?? "?"), 60)}** — ${formaterPourcentage(
                drop.chance,
              )} · ${dropSourceLabel(drop.source as never)} · ${dropCategoryLabel(drop.itemCategory ?? null)}`,
          )
          .join("\n"),
        3800,
      ),
    );
  }

  // Le reste des données de drop n'est PAS paginable (groupes d'esprits agrégés,
  // fèves d'équipe) : on en donne le décompte réel plutôt que de le taire.
  const resume = joindre([
    typeof compteurs.concreteDrops === "number" ? `${formaterNombre(compteurs.concreteDrops)} lots concrets` : null,
    typeof compteurs.dropSources === "number" ? `${formaterNombre(compteurs.dropSources)} sources` : null,
    typeof compteurs.spiritGroups === "number" ? `${formaterNombre(compteurs.spiritGroups)} groupes d'esprits` : null,
    typeof compteurs.beans === "number" ? `${formaterNombre(compteurs.beans)} fèves d'équipe` : null,
  ]);
  if (resume.length > 0) {
    embed.addFields({ name: "Ensemble des données", value: truncate(resume, 1000) });
  }
  pied(embed, { page: page, pages: pages });
  return { embeds: [embed], components: boutonsPagination(etat, page, pages) };
}

/** Page de la liste des coordinateurs : `/api/coordinators` pagine côté serveur. */
async function rendreCoordinateurs(etat: EtatListeAzalee): Promise<InteractionEditReplyOptions> {
  const parametres = {
    page: Math.max(1, etat.page),
    limit: PAR_PAGE,
    ...(etat.recherche ? { q: etat.recherche } : {}),
  };
  const premier = (await azalee().coordinators(parametres as never)) as unknown as Page<FichePerso>;
  const total = premier.total ?? 0;
  const page = bornerPage(etat.page, total, PAR_PAGE);
  const resultat =
    page === parametres.page
      ? premier
      : ((await azalee().coordinators({
          ...parametres,
          page,
        } as never)) as unknown as Page<FichePerso>);
  const entrees = resultat.data ?? [];
  const pages = nombreDePages(total, PAR_PAGE);

  const embed = rgEmbed()
    .setTitle(`Coordinateurs et managers — ${formaterNombre(total)}`)
    .setURL(urlWiki("/entraineur"));
  if (etat.recherche) {
    embed.setAuthor({ name: truncate(`Recherche : « ${etat.recherche} »`, 200) });
  }
  if (entrees.length === 0) {
    embed.setDescription("Aucun coordinateur ne correspond à cette recherche.");
  } else {
    embed.setDescription(
      truncate(
        entrees
          .map(entree => {
            const variante = entree.variants?.[0];
            const nom = `**${truncate(texteFr(entree.names), 60)}**`;
            // Sans ce garde, un coordinateur sans rôle ni élément affichait
            // une ligne se terminant par un tiret orphelin.
            const detail = joindre([
              libelleRoleCoordinateur(variante?.rarity),
              resoudreElement(variante?.element) ?? variante?.element,
            ]);
            return detail.length > 0 ? `${nom} — ${detail}` : nom;
          })
          .join("\n"),
        3800,
      ),
    );
  }
  pied(embed, { page: page, pages: pages });
  return { embeds: [embed], components: boutonsPagination(etat, page, pages) };
}

/**
 * Vues paginables, adressées par le champ `vue` du `customId`.
 *
 * Tout l'état d'une liste tient dans l'identifiant du bouton : aucune mémoire de
 * processus, donc un redémarrage du bot ne laisse jamais de bouton mort.
 */
const VUES_PAGINEES: Record<string, (etat: EtatListeAzalee) => Promise<InteractionEditReplyOptions>> = {
  galerie: rendreGalerie,
  drops: rendreDrops,
  coordinateur: rendreCoordinateurs,
};

@Discord()
@SlashGroup({
  name: "azalee",
  description: "Wiki du jeu Inazuma Eleven: Victory Road (wiki Azalée)",
})
@SlashGroup("azalee")
export class AzaleeJeuCommand {
  @Slash({
    name: "perso",
    description: "Fiche d'un personnage d'Inazuma Eleven: Victory Road : poste, élément, statistiques",
  })
  async perso(
    @SlashOption({
      name: "nom",
      description: "Nom du personnage",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () => {
          const liste = await azalee().characters({
            q: saisie(interaction) || "a",
            limit: 25,
          } as never);
          return (liste.data as unknown as FichePerso[]).map(perso => ({
            name: texteFr(perso.names),
            value: String(perso.baseSlug ?? perso.slug ?? ""),
          }));
        }),
    })
    nom: string,
    @SlashOption({
      name: "rarete",
      description: "Variante à afficher (par défaut : la plus forte)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () =>
          suggerer(RARETES_FR, saisie(interaction)).map(r => ({ name: r, value: r })),
        ),
    })
    rarete: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const perso = await ouvrirFiche<FichePerso>(
        async cle => (await azalee().character(cle)) as unknown as FichePerso,
        async texte => {
          const liste = await azalee().characters({ q: texte, limit: 1 } as never);
          const trouve = (liste.data as unknown as FichePerso[])[0];
          return trouve ? String(trouve.baseSlug ?? trouve.slug ?? "") || null : null;
        },
        nom,
      );

      const variantes = perso.variants ?? [];
      const rareteVoulue = resoudreRarete(rarete);
      const candidates = rareteVoulue ? variantes.filter(v => v.rarity === rareteVoulue) : variantes;
      // À défaut de variante de la rareté demandée, on montre quand même la
      // meilleure plutôt que de répondre « rien » sur un personnage qui existe.
      const retenues = candidates.length > 0 ? candidates : variantes;
      const meilleure = retenues.toSorted((a, b) => totalStats(b) - totalStats(a))[0] ?? ({} as VariantePerso);
      const slug = String(perso.baseSlug ?? perso.slug ?? nom);

      const embed = rgEmbed()
        .setTitle(texteFr(perso.names))
        .setURL(urlWiki(`/chara/${slug}`));

      const resume = truncate(nettoyerTexteJeu(texteFr(perso.descriptions, "")), 400);
      if (resume.length > 0) {
        embed.setDescription(resume);
      }

      const identite = joindre([
        meilleure.position ? `Poste **${meilleure.position}**` : null,
        meilleure.element ? `Élément **${meilleure.element}**` : null,
        meilleure.rarity ? `Rareté **${meilleure.rarity}**` : null,
      ]);
      if (identite.length > 0) {
        embed.addFields({ name: "Identité", value: identite });
      }

      const stats = ligneStats(meilleure.stats?.lv99);
      if (stats) {
        // L'embed dit de QUELLE variante viennent ces chiffres : un personnage
        // à neuf variantes n'a pas « des » statistiques, il en a neuf jeux.
        embed.addFields({
          name: `Statistiques niveau 99 — variante ${meilleure.rarity ?? "par défaut"}`,
          value: stats,
        });
      }

      const apprises = (meilleure.skills ?? []).filter(
        (s): s is TechniqueApprise & { skillId: string } => typeof s.skillId === "string",
      );
      if (apprises.length > 0) {
        const noms = await Promise.all(
          apprises.slice(0, 10).map(async technique => {
            const nomTech = await nomTechnique(technique.skillId);
            if (!nomTech) {
              return null;
            }
            return typeof technique.learnLevel === "number" && technique.learnLevel > 0
              ? `Niv. ${technique.learnLevel} — ${nomTech}`
              : nomTech;
          }),
        );
        const lignes = noms.filter((n): n is string => n !== null);
        if (lignes.length > 0) {
          embed.addFields({
            name: `Techniques apprises (${apprises.length})`,
            value: truncate(lignes.join("\n"), 1000),
          });
        }
      }

      const raretes = [...new Set(variantes.map(v => v.rarity).filter(Boolean))];
      const equipe = await nomEquipe(perso);
      const contexte = joindre([
        equipe ? `Équipe **${equipe}**` : null,
        perso.series ? `Série **${perso.series}**` : null,
        perso.constellation?.names ? `Signe **${texteFr(perso.constellation.names, "?")}**` : null,
        variantes.length > 1
          ? `${variantes.length} variantes${raretes.length > 1 ? ` (${raretes.join(", ")})` : ""}`
          : null,
        perso.internalCode ? `Code \`${perso.internalCode}\`` : null,
      ]);
      if (contexte.length > 0) {
        embed.addFields({ name: "Contexte", value: truncate(contexte, 1000) });
      }

      // Le portrait 256×256 vit dans les CPK ; `image_url` est vide en base pour
      // les personnages du jeu, on le dérive donc du code interne.
      const codeVisage = meilleure.internalCode ?? perso.internalCode;
      const portrait =
        (await illustrationProuvee(urlVisage(codeVisage), 200)) ??
        (await illustrationProuvee(meilleure.image ?? perso.image, 200)) ??
        iconeElementUrl(meilleure.element);
      if (portrait) {
        embed.setThumbnail(portrait);
      }

      // Même repère que sur les techniques : la couleur dit l'élément avant la
      // lecture. `meilleure` est la variante retenue pour la fiche.
      const couleurPerso = couleurElement(meilleure.element);
      if (couleurPerso !== null) {
        embed.setColor(couleurPerso);
      }

      const modele = urlModele3d(codeVisage ?? null);
      if (modele) {
        embed.addFields({ name: "Modèle 3D complet", value: modele });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  @Slash({ name: "technique", description: "Fiche d'une technique spéciale (hissatsu)" })
  async technique(
    @SlashOption({
      name: "nom",
      description: "Nom de la technique",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () => {
          // Les filtres déjà saisis restreignent les propositions — traduits
          // en libellés FRANÇAIS, seuls exploitables par la base.
          const categorie = resoudreCategorieTechnique(interaction.options.getString("categorie"));
          const element = resoudreElement(interaction.options.getString("element"));
          const liste = await azalee().skills({
            q: saisie(interaction) || undefined,
            limit: 25,
            ...(categorie ? { category: categorie } : {}),
            ...(element ? { element } : {}),
          } as never);
          return (liste.data as unknown as FicheTechnique[]).map(technique => {
            const etiquette = joindre([technique.categoryName?.fr, technique.elementName?.fr]);
            return {
              name: etiquette ? `${texteFr(technique.names)} — ${etiquette}` : texteFr(technique.names),
              value: String(technique.skillId ?? technique.internalCode ?? ""),
            };
          });
        }),
    })
    nom: string,
    @SlashOption({
      name: "categorie",
      description: "Catégorie : Tir, Dribble, Défense, Arrêt",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () =>
          suggerer(CATEGORIES_TECHNIQUE_FR, saisie(interaction)).map(c => ({ name: c, value: c })),
        ),
    })
    _categorie: string | undefined,
    @SlashOption({
      name: "element",
      description: "Élément : Feu, Vent, Forêt, Montagne, Néant",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () =>
          suggerer(ELEMENTS_FR, saisie(interaction)).map(e => ({ name: e, value: e })),
        ),
    })
    _element: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const technique = await ouvrirFiche<FicheTechnique>(
        async cle => (await azalee().skill(cle)) as unknown as FicheTechnique,
        async texte => {
          const liste = await azalee().skills({ q: texte, limit: 1 } as never);
          const trouve = (liste.data as unknown as FicheTechnique[])[0];
          return trouve ? String(trouve.skillId ?? trouve.internalCode ?? "") || null : null;
        },
        nom,
      );
      const embed = rgEmbed()
        .setTitle(texteFr(technique.names, technique.displayName ?? "Technique"))
        .setURL(urlWiki(`/skill/${encodeURIComponent(String(technique.skillId ?? nom))}`));

      const resume = truncate(nettoyerTexteJeu(texteFr(technique.descriptions, "")), 400);
      if (resume.length > 0) {
        embed.setDescription(resume);
      }

      const nature = joindre([
        technique.categoryName?.fr ? `Catégorie **${technique.categoryName.fr}**` : null,
        technique.elementName?.fr ? `Élément **${technique.elementName.fr}**` : null,
        technique.skillType ? `Type \`${technique.skillType}\`` : null,
      ]);
      if (nature.length > 0) {
        embed.addFields({ name: "Nature", value: nature });
      }

      const chiffres = joindre([
        technique.powerRange ? `Puissance **${technique.powerRange}**` : null,
        typeof technique.consumeTp === "number" ? `Tension **${technique.consumeTp}**` : null,
        typeof technique.recastTime === "number" ? `Recharge **${technique.recastTime}**` : null,
        technique.growthSpeed ? `Croissance **${technique.growthSpeed}**` : null,
      ]);
      if (chiffres.length > 0) {
        embed.addFields({ name: "Chiffres", value: chiffres });
      }
      const boutiques = technique.shops?.fr ?? [];
      if (boutiques.length > 0) {
        embed.addFields({ name: "En vente", value: truncate(boutiques.join(", "), 500) });
      }
      if (technique.videoUrl) {
        embed.addFields({ name: "Vidéo", value: truncate(technique.videoUrl, 500) });
      }

      // La fiche prend la couleur de son élément — c'est le repère que le wiki
      // utilise dans ses listes, et il est gratuit ici. Élément inconnu :
      // `couleurElement` rend `null` et l'embed garde la couleur du profil
      // plutôt que d'inventer une teinte.
      const couleurTechnique = couleurElement(texteFr(technique.elementName, ""));
      if (couleurTechnique !== null) {
        embed.setColor(couleurTechnique);
      }

      // Le télop d'une technique est un bandeau 1728×352 (~330 Ko en PNG brut) :
      // on le demande en WebP w=800 au service de variantes.
      const illustration = await illustrationProuvee(technique.image, 800);
      if (illustration) {
        embed.setImage(illustration);
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  @Slash({ name: "objet", description: "Fiche d'un objet : équipement, consommable, matériau…" })
  async objet(
    @SlashOption({
      name: "nom",
      description: "Nom de l'objet",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () => {
          const liste = await azalee().items({
            q: saisie(interaction) || undefined,
            limit: 25,
          } as never);
          return (liste.data as unknown as FicheObjet[]).map(objet => {
            const categorie = libelleCategorieObjet(objet.category);
            return {
              name: categorie ? `${texteFr(objet.names)} — ${categorie}` : texteFr(objet.names),
              value: String(objet.itemId ?? ""),
            };
          });
        }),
    })
    nom: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      // Même repli par recherche que les autres fiches : `/api/items/<id>`
      // n'accepte qu'un identifiant, or un membre tape le nom de l'objet.
      const objet = await ouvrirFiche<FicheObjet>(
        async cle => (await azalee().item(cle)) as unknown as FicheObjet,
        async texte => {
          const liste = await azalee().items({ q: texte, limit: 1 } as never);
          const trouve = (liste.data as unknown as FicheObjet[])[0];
          return trouve ? String(trouve.itemId ?? "") || null : null;
        },
        nom,
      );
      const embed = rgEmbed()
        .setTitle(texteFr(objet.names))
        .setURL(urlWiki(`/item/${encodeURIComponent(String(objet.itemId ?? nom))}`));

      const resume = truncate(nettoyerTexteJeu(texteFr(objet.descriptions, "")), 400);
      if (resume.length > 0) {
        embed.setDescription(resume);
      }

      const fiche = joindre([
        // L'API sert l'identifiant du jeu (`craft_obj`) : une UI française
        // affiche « Matériau ».
        libelleCategorieObjet(objet.category) ? `Catégorie **${libelleCategorieObjet(objet.category)}**` : null,
        typeof objet.price === "number" ? `Prix **${objet.price.toLocaleString("fr-FR")}**` : null,
        objet.internalCode ? `Code \`${objet.internalCode}\`` : null,
      ]);
      if (fiche.length > 0) {
        embed.addFields({ name: "Fiche", value: fiche });
      }

      // `objet.stats` est NULL sur les 200 objets mesurés : lire ce champ
      // faisait disparaître le bloc « Bonus » de TOUTES les fiches d'objet.
      // Les vraies valeurs sont dans `bonuses` (« Collier cramoisi » :
      // Frappe 22 · Contrôle 22).
      const stats = ligneStats(objet.bonuses ?? objet.stats);
      if (stats) {
        embed.addFields({ name: "Bonus de statistiques", value: stats });
      }
      const boutiques = objet.shops?.fr ?? [];
      if (boutiques.length > 0) {
        embed.addFields({ name: "En vente", value: truncate(boutiques.join(", "), 500) });
      }

      // Les icônes d'objet sont des sous-textures d'atlas, non servies par le
      // CDN : `imageJeu` les refuse, l'embed reste propre au lieu d'afficher un
      // cadre cassé (c'était le cas dans `/ievr objet`).
      const illustration = await illustrationProuvee(objet.image, 200);
      if (illustration) {
        embed.setThumbnail(illustration);
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  @Slash({ name: "equipe", description: "Fiche d'une équipe : emblème, séries, effectif" })
  async equipe(
    @SlashOption({
      name: "nom",
      description: "Nom de l'équipe",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () => {
          const equipes = await equipesConnues();
          return classerPropositions(
            equipes,
            saisie(interaction),
            equipe => `${equipe.name ?? ""} ${equipe.nameEn ?? ""} ${equipe.nameJa ?? ""}`,
          ).map(equipe => ({
            name: `${equipe.name ?? equipe.nameEn ?? "Équipe"} (${equipe.rosterCount ?? 0} joueurs)`,
            value: String(equipe.id ?? ""),
          }));
        }),
    })
    nom: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      // Même repli par nom que les autres fiches : `/api/teams/<id>` n'accepte
      // que le hash de l'équipe — mesuré, `/api/teams/Raimon` répond 404 —
      // alors qu'un membre qui ignore l'autocomplétion tape « Raimon ».
      const equipe = await ouvrirFiche<FicheEquipe>(
        async cle => (await azalee().team(cle)) as unknown as FicheEquipe,
        async texte => {
          const [trouvee] = classerPropositions(
            await equipesConnues(),
            texte,
            candidate => `${candidate.name ?? ""} ${candidate.nameEn ?? ""} ${candidate.nameJa ?? ""}`,
            1,
          );
          return trouvee?.id ? String(trouvee.id) : null;
        },
        nom,
      );
      const effectif = equipe.roster ?? [];
      const embed = rgEmbed()
        .setTitle(String(equipe.name ?? equipe.nameEn ?? "Équipe"))
        .setURL(urlWiki(`/equipe/${encodeURIComponent(String(equipe.id ?? nom))}`));

      const resume = truncate(nettoyerTexteJeu(String(equipe.descriptionFr ?? equipe.descriptionEn ?? "")), 400);
      if (resume.length > 0) {
        embed.setDescription(resume);
      }
      const autresNoms = joindre([equipe.nameEn, equipe.nameJa]);
      if (autresNoms.length > 0) {
        embed.addFields({ name: "Autres noms", value: truncate(autresNoms, 500) });
      }
      const series = Object.entries(equipe.seasons ?? {})
        .map(([clef, n]) => `${clef} (${n})`)
        .join(" · ");
      if (series.length > 0) {
        embed.addFields({ name: "Présences par série", value: truncate(series, 500) });
      }
      if (effectif.length > 0) {
        const apercu = effectif
          .slice(0, 12)
          .map(joueur => `${joueur.name} — ${joueur.position ?? "?"} · ${joueur.element ?? "?"}`)
          .join("\n");
        embed.addFields({ name: `Effectif (${effectif.length})`, value: truncate(apercu, 900) });
      }
      const embleme = await illustrationProuvee(equipe.emblemUrl, 200);
      if (embleme) {
        embed.setThumbnail(embleme);
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  @Slash({
    name: "recherche",
    description: "Cherche partout : personnages, techniques et objets d'un coup",
  })
  async recherche(
    @SlashOption({
      name: "texte",
      description: "Ce que tu cherches",
      type: ApplicationCommandOptionType.String,
      required: true,
      minLength: 2,
    })
    texte: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const resultat = (await azalee().search({
        q: texte,
        limit: 8,
      })) as unknown as ResultatRecherche;
      const embed = rgEmbed()
        .setTitle(`Recherche « ${truncate(texte, 60)} »`)
        .setURL(urlWiki(`/search?q=${encodeURIComponent(texte)}`));

      const sections: Array<{ titre: string; lignes: string[] }> = [
        {
          titre: "Personnages",
          lignes: (resultat.characters ?? []).map(
            perso => `[${texteFr(perso.names)}](${urlWiki(`/chara/${perso.baseSlug ?? perso.slug}`)})`,
          ),
        },
        {
          titre: "Techniques",
          lignes: (resultat.skills ?? []).map(
            technique =>
              `[${texteFr(technique.names)}](${urlWiki(`/skill/${encodeURIComponent(String(technique.skillId))}`)})`,
          ),
        },
        {
          titre: "Objets",
          lignes: (resultat.items ?? []).map(
            objet => `[${texteFr(objet.names)}](${urlWiki(`/item/${encodeURIComponent(String(objet.itemId))}`)})`,
          ),
        },
      ];

      const remplies = sections.filter(section => section.lignes.length > 0);
      if (remplies.length === 0) {
        await interaction.editReply({
          content: `Aucun résultat pour « ${truncate(texte, 80)} ».`,
        });
        return;
      }
      for (const section of remplies) {
        embed.addFields({
          name: `${section.titre} (${section.lignes.length})`,
          value: truncate(section.lignes.join("\n"), 900),
        });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Auras -------------------------------------------------------------

  @Slash({
    name: "aura",
    description: "Aura : esprit guerrier, totem, Miximax, éveil ou changement de mode",
  })
  async aura(
    @SlashOption({
      name: "famille",
      description: "Famille d'aura (esprits guerriers, totems, Miximax, éveils…)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () =>
          classerPropositions([...TYPES_AURA], saisie(interaction), type => type.libelle).map(type => ({
            name: type.libelle,
            value: type.slug,
          })),
        ),
    })
    famille: string,
    @SlashOption({
      name: "nom",
      description: "Aura précise (laisser vide pour parcourir la famille)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () => {
          // Un slug de famille inventé fait répondre `{"data":[],"total":0}` :
          // sans famille valide on ne propose rien plutôt qu'une liste vide.
          const type = resoudreTypeAura(interaction.options.getString("famille"));
          if (!type) {
            return [];
          }
          const liste = (await azalee().auras(type, {
            q: saisie(interaction) || undefined,
            limit: 25,
          } as never)) as unknown as Page<EntreeAura>;
          return (liste.data ?? []).map(entree => ({
            name: String(entree.name ?? entree.id ?? "Aura"),
            value: String(entree.id ?? ""),
          }));
        }),
    })
    nom: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const type: SlugAura | null = resoudreTypeAura(famille);
      if (!type) {
        await repondre(
          interaction,
          echec(
            "Valeur inconnue",
            `Famille d'aura inconnue. Choisis parmi : ${TYPES_AURA.map(t => t.libelle).join(", ")}.`,
          ),
        );
        return;
      }

      if (!nom) {
        const liste = (await azalee().auras(type, {
          limit: 25,
        } as never)) as unknown as Page<EntreeAura>;
        const entrees = liste.data ?? [];
        const embed = rgEmbed()
          .setTitle(`${libelleTypeAura(type)} — ${formaterNombre(liste.total ?? entrees.length)}`)
          .setURL(urlWiki(`/aura/${type}`));
        embed.setDescription(
          entrees.length === 0
            ? "Aucune aura dans cette famille."
            : truncate(entrees.map(entree => `**${truncate(String(entree.name ?? "?"), 60)}**`).join(" · "), 3800),
        );
        pied(embed, {
          note: "Relance la commande avec l'option « nom » pour ouvrir une fiche · azalee.rosegriffon.fr",
        });
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const fiche = (await azalee().aura(type, nom)) as unknown as FicheAura;
      const embed = rgEmbed()
        .setTitle(truncate(String(fiche.displayName ?? fiche.name_FR ?? "Aura"), 200))
        .setURL(urlWiki(`/aura/${type}/${encodeURIComponent(String(fiche.auraId ?? nom))}`));

      const resume = truncate(nettoyerTexteJeu(fiche.desc_FR ?? ""), 400);
      if (resume.length > 0) {
        embed.setDescription(resume);
      }
      const nature = joindre([
        `Famille **${libelleTypeAura(type)}**`,
        fiche.elementName?.fr ? `Élément **${fiche.elementName.fr}**` : null,
        fiche.assetCode ? `Code \`${fiche.assetCode}\`` : null,
      ]);
      if (nature.length > 0) {
        embed.addFields({ name: "Nature", value: truncate(nature, 1000) });
      }

      const hissatsu = fiche.sheetData?.hissatsu;
      if (hissatsu?.name) {
        const puissance =
          typeof hissatsu.power?.min === "number" && typeof hissatsu.power?.max === "number"
            ? `Puissance **${hissatsu.power.min}–${hissatsu.power.max}**`
            : null;
        embed.addFields({
          name: "Technique liée",
          value: truncate(joindre([`**${hissatsu.name}**`, hissatsu.type, hissatsu.element, puissance]), 1000),
        });
      }

      const autresNoms = joindre([fiche.name_EN, fiche.name_JA]);
      if (autresNoms.length > 0) {
        embed.addFields({ name: "Autres noms", value: truncate(autresNoms, 500) });
      }

      const icone = await illustrationProuvee(fiche.image, 200);
      if (icone) {
        embed.setThumbnail(icone);
      }
      const telop = await illustrationProuvee(fiche.telopUrl, 800);
      if (telop) {
        embed.setImage(telop);
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Tactiques ---------------------------------------------------------

  @Slash({
    name: "tactique",
    description: "Fiche d'une tactique spéciale : effets, durée, recharge",
  })
  async tactique(
    @SlashOption({
      name: "nom",
      description: "Nom de la tactique",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () => {
          const liste = (await azalee().tactics({
            q: saisie(interaction) || undefined,
            limit: 25,
          } as never)) as unknown as Page<EntreeTactique>;
          return (liste.data ?? []).map(tactique => ({
            name: texteFr(tactique.names),
            value: String(tactique.itemId ?? ""),
          }));
        }),
    })
    nom: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      // `/api/tactics/<clé>` accepte le code interne comme le slug (mesuré :
      // `wht30180` et `absolute-barrier` répondent 200 tous les deux).
      const tactique = await ouvrirFiche<FicheTactique>(
        async cle => (await azalee().tactic(cle)) as unknown as FicheTactique,
        async texte => {
          const liste = (await azalee().tactics({
            q: texte,
            limit: 1,
          } as never)) as unknown as Page<EntreeTactique>;
          const trouvee = (liste.data ?? [])[0];
          return trouvee?.itemId ? String(trouvee.itemId) : null;
        },
        nom,
      );
      const embed = rgEmbed()
        .setTitle(truncate(String(tactique.name_fr ?? tactique.name ?? "Tactique"), 200))
        .setURL(urlWiki(`/tactic/${encodeURIComponent(String(tactique.slug ?? nom))}`));

      const resume = truncate(nettoyerTexteJeu(tactique.description_fr ?? ""), 400);
      if (resume.length > 0) {
        embed.setDescription(resume);
      }

      const effets = [tactique.effect1, tactique.effect2, tactique.effect3].filter(
        (e): e is string => typeof e === "string" && e.trim().length > 0,
      );
      if (effets.length > 0) {
        embed.addFields({
          // Le jeu ne fournit ces effets QU'en anglais : `inagle_tactics` n'a
          // pas de colonne `effect*_fr`. On le dit plutôt que de laisser croire
          // à un oubli de traduction du bot.
          name: `Effets (${effets.length}) — non traduits dans le jeu`,
          value: truncate(effets.map(effet => `• ${effet}`).join("\n"), 1000),
        });
      }

      const chiffres = joindre([
        typeof tactique.duration === "number" ? `Durée **${tactique.duration} s**` : null,
        typeof tactique.cooldown === "number" ? `Recharge **${tactique.cooldown} s**` : null,
        typeof tactique.power === "number" ? `Puissance **${tactique.power}**` : null,
        typeof tactique.partnerCount === "number" && tactique.partnerCount > 0
          ? `Partenaires **${tactique.partnerCount}**`
          : null,
        tactique.element ? `Élément **${tactique.element}**` : null,
      ]);
      if (chiffres.length > 0) {
        embed.addFields({ name: "Chiffres", value: truncate(chiffres, 1000) });
      }
      if (tactique.shop) {
        embed.addFields({ name: "En vente", value: truncate(tactique.shop, 500) });
      }
      if (tactique.internalCode) {
        embed.addFields({ name: "Code interne", value: `\`${tactique.internalCode}\`` });
      }

      const telop = await illustrationProuvee(tactique.image, 800);
      if (telop) {
        embed.setImage(telop);
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Passifs -----------------------------------------------------------

  @Slash({ name: "passif", description: "Fiche d'une compétence passive : effet, valeur, rareté" })
  async passif(
    @SlashOption({
      name: "effet",
      description: "Mots de l'effet recherché (ex. « tir », « arrêt »)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () => {
          const liste = (await azalee().passives({
            q: saisie(interaction) || undefined,
            limit: 25,
          } as never)) as unknown as Page<FichePassif>;
          return (liste.data ?? []).map(passif => ({
            // Beaucoup de passifs n'ont AUCUN libellé traduit (mesuré : les
            // deux premières lignes de `/api/passives` ont `name` à null sur
            // les trois langues). L'identifiant de chaîne reste alors la
            // seule étiquette honnête.
            name: truncate(nettoyerTexteJeu(texteFr(passif.name, "")) || String(passif.string_id ?? "Passif"), 100),
            value: String(passif.passive_id ?? ""),
          }));
        }),
    })
    effet: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const passif = await ouvrirFiche<FichePassif>(
        async cle => (await azalee().passive(cle)) as unknown as FichePassif,
        async texte => {
          const liste = (await azalee().passives({
            q: texte,
            limit: 1,
          } as never)) as unknown as Page<FichePassif>;
          const trouve = (liste.data ?? [])[0];
          return trouve?.passive_id ? String(trouve.passive_id) : null;
        },
        effet,
      );

      // Le repli d'un libellé absent passe par le japonais, qui porte des
      // annotations de lecture `[漢字/かんじ]` illisibles dans un embed.
      const libelle = nettoyerRubis(nettoyerTexteJeu(texteFr(passif.name, "")));
      const description = nettoyerRubis(nettoyerTexteJeu(texteFr(passif.description, "")));

      const embed = rgEmbed()
        .setTitle(truncate(libelle || String(passif.string_id ?? "Passif"), 200))
        .setURL(urlWiki(`/passive/${encodeURIComponent(String(passif.passive_id ?? effet))}`));
      if (description.length > 0 && description !== libelle) {
        embed.setDescription(truncate(description, 1000));
      } else if (libelle.length === 0) {
        embed.setDescription("Ce passif n'a aucun libellé traduit dans les données du jeu.");
      }

      const fiche = joindre([
        typeof passif.main_value === "number" ? `Valeur **${formaterNombre(passif.main_value)}**` : null,
        typeof passif.rarity === "number" ? `Rareté **${passif.rarity}**` : null,
        passif.element_name ? `Élément \`${passif.element_name}\`` : null,
      ]);
      if (fiche.length > 0) {
        embed.addFields({ name: "Fiche", value: truncate(fiche, 1000) });
      }
      const identifiants = joindre([
        passif.passive_id ? `Passif \`${passif.passive_id}\`` : null,
        passif.string_id ? `Chaîne \`${passif.string_id}\`` : null,
        passif.effect_id ? `Effet \`${passif.effect_id}\`` : null,
      ]);
      if (identifiants.length > 0) {
        embed.addFields({ name: "Identifiants", value: truncate(identifiants, 1000) });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Quêtes ------------------------------------------------------------

  @Slash({ name: "quete", description: "Fiche d'une quête : genre, phase et illustration" })
  async quete(
    @SlashOption({
      name: "titre",
      description: "Titre de la quête",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () => {
          const genre = interaction.options.getString("genre");
          const quetes = (await quetesConnues()).filter(quete => (genre ? quete.kind === genre : true));
          return classerPropositions(quetes, saisie(interaction), quete =>
            texteFr(quete.titles, quete.title ?? ""),
          ).map(quete => ({
            name: truncate(texteFr(quete.titles, quete.title ?? "Quête"), 100),
            value: String(quete.id ?? ""),
          }));
        }),
    })
    titre: string,
    @SlashChoice(...CHOIX_GENRE_QUETE)
    @SlashOption({
      name: "genre",
      description: "Quête principale (137) ou quête annexe (45)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    _genre: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const quete = await ouvrirFiche<FicheQuete>(
        async cle => (await azalee().quest(cle)) as unknown as FicheQuete,
        async texte => {
          const [trouvee] = classerPropositions(
            await quetesConnues(),
            texte,
            candidate => texteFr(candidate.titles, candidate.title ?? ""),
            1,
          );
          return trouvee?.id ? String(trouvee.id) : null;
        },
        titre,
      );
      const embed = rgEmbed()
        .setTitle(truncate(texteFr(quete.titles, quete.title ?? "Quête"), 200))
        .setURL(urlWiki(`/quete/${encodeURIComponent(String(quete.id ?? titre))}`));

      const fiche = joindre([
        `Genre **${libelleGenreQuete(quete.kind)}**`,
        typeof quete.phase === "number" ? `Phase **${quete.phase}**` : null,
        quete.area ? `Zone **${quete.area}**` : null,
        quete.id ? `Identifiant \`${quete.id}\`` : null,
      ]);
      if (fiche.length > 0) {
        embed.addFields({ name: "Fiche", value: truncate(fiche, 1000) });
      }
      const autresTitres = joindre([quete.titles?.en, quete.titles?.ja]);
      if (autresTitres.length > 0) {
        embed.addFields({ name: "Autres titres", value: truncate(autresTitres, 500) });
      }

      // L'API ne sert qu'un code d'image nu : on forge l'URL du CDN et on
      // vérifie dans l'index CPK que le fichier existe (45 quêtes sur 182 n'en
      // ont aucun).
      const illustration = await illustrationProuvee(urlIllustrationQuete(quete.image), 800);
      if (illustration) {
        embed.setImage(illustration);
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Entraîneurs -------------------------------------------------------

  @Slash({
    name: "entraineur",
    description: "Fiche d'un entraîneur : rôle, style, bonus d'équipe et progression",
  })
  async entraineur(
    @SlashOption({
      name: "nom",
      description: "Nom de l'entraîneur",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () =>
          classerPropositions(
            await entraineursConnus(),
            saisie(interaction),
            coach => `${coach.name ?? ""} ${coach.nameRomaji ?? ""} ${coach.nameKanji ?? ""}`,
          ).map(coach => ({
            name: truncate(`${coach.name ?? "Entraîneur"}${coach.roleFr ? ` — ${coach.roleFr}` : ""}`, 100),
            value: String(coach.id ?? ""),
          })),
        ),
    })
    nom: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      // `/api/coaches/:id` attend un ENTIER. Un membre qui tape le nom au lieu
      // de valider l'autocomplétion doit quand même être servi.
      const identifiant = Number.parseInt(nom, 10);
      let coach: FicheEntraineur | null = null;
      if (Number.isFinite(identifiant) && String(identifiant) === nom.trim()) {
        coach = (await azalee().coach(identifiant)) as unknown as FicheEntraineur;
      } else {
        const [trouve] = classerPropositions(
          await entraineursConnus(),
          nom,
          candidat => `${candidat.name ?? ""} ${candidat.nameRomaji ?? ""} ${candidat.nameKanji ?? ""}`,
          1,
        );
        coach = trouve ?? null;
      }
      if (!coach) {
        await interaction.editReply({ content: "❌ Introuvable dans le wiki." });
        return;
      }

      const embed = rgEmbed()
        .setTitle(truncate(String(coach.name ?? "Entraîneur"), 200))
        .setURL(urlWiki(`/entraineur/${encodeURIComponent(String(coach.id ?? ""))}`));

      const identite = joindre([
        coach.roleFr ? `Rôle **${coach.roleFr}**` : null,
        coach.playstyleFr ? `Style **${coach.playstyleFr}**` : null,
        coach.elementFr ? `Élément **${coach.elementFr}**` : null,
      ]);
      if (identite.length > 0) {
        embed.addFields({ name: "Identité", value: truncate(identite, 1000) });
      }

      const bonus = joindre([
        coach.stat ? `Statistique **${coach.stat}**` : null,
        coach.buff ? `Bonus **${coach.buff}**` : null,
        coach.requirements ? `Condition : ${coach.requirements}` : null,
      ]);
      if (bonus.length > 0) {
        // `inagle_manager_passives.stat` et `.requirements` n'existent qu'en
        // anglais dans les données du jeu.
        embed.addFields({
          name: "Effet — libellés non traduits dans le jeu",
          value: truncate(bonus, 1000),
        });
      }

      const progression = joindre([
        coach.scaling?.coordCommon ? `Coordinateur commun **${coach.scaling.coordCommon}**` : null,
        coach.scaling?.coordLegendary ? `Coordinateur légendaire **${coach.scaling.coordLegendary}**` : null,
        coach.scaling?.managerCommon ? `Manager commun **${coach.scaling.managerCommon}**` : null,
        coach.scaling?.managerLegendary ? `Manager légendaire **${coach.scaling.managerLegendary}**` : null,
      ]);
      if (progression.length > 0) {
        embed.addFields({ name: "Progression", value: truncate(progression, 1000) });
      }
      const autresNoms = joindre([coach.nameRomaji, coach.nameKanji]);
      if (autresNoms.length > 0) {
        embed.addFields({ name: "Autres noms", value: truncate(autresNoms, 500) });
      }

      // `image` est NULL pour les 102 entraîneurs : le visage se dérive du code
      // interne, présent dans l'index CPK (18/18 codes essayés répondent 200).
      const portrait =
        (await illustrationProuvee(urlVisage(coach.internalCode), 200)) ??
        (await illustrationProuvee(coach.image, 200));
      if (portrait) {
        embed.setThumbnail(portrait);
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Stades ------------------------------------------------------------

  @Slash({ name: "stade", description: "Fiche d'un stade, avec son visuel de terrain" })
  async stade(
    @SlashOption({
      name: "nom",
      description: "Nom du stade",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () =>
          classerPropositions(
            await stadesConnus(),
            saisie(interaction),
            stade => `${stade.title ?? ""} ${stade.code ?? ""}`,
          ).map(stade => ({
            name: truncate(String(stade.title ?? stade.code ?? "Stade"), 100),
            value: String(stade.id ?? ""),
          })),
        ),
    })
    nom: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const stade = await ouvrirFiche<FicheStade>(
        async cle => (await azalee().stadium(cle)) as unknown as FicheStade,
        async texte => {
          const [trouve] = classerPropositions(
            await stadesConnus(),
            texte,
            candidat => `${candidat.title ?? ""} ${candidat.code ?? ""}`,
            1,
          );
          return trouve?.id ? String(trouve.id) : null;
        },
        nom,
      );
      const embed = rgEmbed()
        .setTitle(truncate(String(stade.title ?? stade.code ?? "Stade"), 200))
        .setURL(urlWiki(`/stade/${encodeURIComponent(String(stade.id ?? nom))}`));

      const fiche = joindre([
        typeof stade.index === "number" ? `Position **${stade.index + 1}** sur 81` : null,
        stade.code ? `Code \`${stade.code}\`` : null,
        stade.id ? `Identifiant \`${stade.id}\`` : null,
      ]);
      if (fiche.length > 0) {
        embed.addFields({ name: "Fiche", value: truncate(fiche, 1000) });
      }

      // Le visuel de terrain brut pèse plusieurs mégaoctets ; la variante
      // w=800 en fait 78 Ko (mesuré sur `img_room_s90g001`).
      const visuel = await illustrationProuvee(stade.image, 800);
      if (visuel) {
        embed.setImage(visuel);
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Succès ------------------------------------------------------------

  @Slash({
    name: "succes",
    description: "Fiche d'un succès ou d'un trophée : condition d'obtention",
  })
  async succes(
    @SlashOption({
      name: "nom",
      description: "Nom du succès",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () => {
          const categorie = interaction.options.getString("categorie");
          const succes = (await succesConnus()).filter(entree => (categorie ? entree.category === categorie : true));
          return classerPropositions(
            succes,
            saisie(interaction),
            entree => `${texteFr(entree.names, entree.name ?? "")} ${entree.desc ?? ""}`,
          ).map(entree => ({
            name: truncate(texteFr(entree.names, entree.name ?? "Succès"), 100),
            value: String(entree.id ?? ""),
          }));
        }),
    })
    nom: string,
    @SlashChoice(...CHOIX_CATEGORIE_SUCCES)
    @SlashOption({
      name: "categorie",
      description: "Trophée (52) ou activité (176)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    _categorie: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const succes = await ouvrirFiche<FicheSucces>(
        async cle => (await azalee().trophy(cle)) as unknown as FicheSucces,
        async texte => {
          const [trouve] = classerPropositions(
            await succesConnus(),
            texte,
            candidat => `${texteFr(candidat.names, candidat.name ?? "")} ${candidat.desc ?? ""}`,
            1,
          );
          return trouve?.id ? String(trouve.id) : null;
        },
        nom,
      );
      const embed = rgEmbed()
        .setTitle(truncate(texteFr(succes.names, succes.name ?? "Succès"), 200))
        .setURL(urlWiki(`/succes/${encodeURIComponent(String(succes.id ?? nom))}`));

      const condition = nettoyerTexteJeu(texteFr(succes.descriptions, succes.desc ?? ""));
      if (condition.length > 0) {
        embed.setDescription(truncate(condition, 1000));
      }
      const fiche = joindre([
        `Catégorie **${libelleCategorieSucces(succes.category)}**`,
        succes.groupLabel ? `Groupe **${succes.groupLabel}**` : null,
        succes.id ? `Code \`${succes.id}\`` : null,
      ]);
      embed.addFields({ name: "Fiche", value: truncate(fiche, 1000) });
      const autresNoms = joindre([succes.names?.en, succes.names?.ja]);
      if (autresNoms.length > 0) {
        embed.addFields({ name: "Autres noms", value: truncate(autresNoms, 500) });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Capsules ----------------------------------------------------------

  @Slash({ name: "capsule", description: "Lots de capsules (gacha) : pools de tirage et contenus" })
  async capsule(
    @SlashOption({
      name: "lot",
      description: "Hash d'un lot ou d'un contenu (ex. 0x6AE7)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    lot: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const liste = (await azalee().capsules(lot ? ({ q: lot } as never) : undefined)) as unknown as ListeCapsules;
      const lots = liste.data ?? [];
      const embed = rgEmbed()
        .setTitle(
          `Capsules — ${formaterNombre(liste.total ?? lots.length)} lot${(liste.total ?? lots.length) > 1 ? "s" : ""}`,
        )
        .setURL(urlWiki("/capsule"));

      if (lot) {
        embed.setAuthor({ name: truncate(`Recherche : « ${lot} »`, 200) });
      }
      if (lots.length === 0) {
        embed.setDescription(lot ? "Aucun lot ne porte ce hash." : "La table des capsules ne contient aucun lot.");
      } else {
        // ⚠ `contentRef` ne résout vers AUCUNE table extraite : la
        // bibliothèque le dit explicitement (`wiki/gacha.ts`). On sert donc
        // les hachages tels quels plutôt que de leur inventer un nom d'objet.
        const lignes = lots
          .slice(0, 20)
          .map(entree => `\`${entree.id}\` → contenu \`${entree.contentRef}\` · pool \`${entree.poolRef}\``);
        embed.setDescription(truncate(lignes.join("\n"), 3800));
      }

      const pools = liste.pools ?? [];
      if (pools.length > 0) {
        embed.addFields({
          name: `Pools de tirage (${pools.length})`,
          value: truncate(pools.map(pool => `\`${pool.ref}\` — ${formaterNombre(pool.count)} lots`).join("\n"), 1000),
        });
      }
      pied(embed, {
        note: "Les références de contenu ne sont résolues par aucune table extraite du jeu · azalee.rosegriffon.fr",
      });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Costumes ----------------------------------------------------------

  @Slash({
    name: "costume",
    description: "Costumes de personnage : types et modèles 3D référencés",
  })
  async costume(
    @SlashOption({
      name: "recherche",
      description: "Index du costume ou hash de modèle (ex. 42, 0x2333)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    recherche: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const liste = (await azalee().costumes(
        recherche ? ({ q: recherche } as never) : undefined,
      )) as unknown as ListeCostumes;
      const costumes = liste.data ?? [];
      const embed = rgEmbed()
        .setTitle(`Costumes — ${formaterNombre(liste.total ?? costumes.length)}`)
        .setURL(urlWiki("/capsule?tab=costumes"));
      if (recherche) {
        embed.setAuthor({ name: truncate(`Recherche : « ${recherche} »`, 200) });
      }

      if (costumes.length === 0) {
        embed.setDescription("Aucun costume ne correspond à cette recherche.");
      } else {
        const lignes = costumes
          .slice(0, 20)
          .map(costume => `**#${costume.index}** · ${costume.typeLabel ?? "?"} — modèle \`${costume.modelRef}\``);
        embed.setDescription(truncate(lignes.join("\n"), 3800));
      }

      const types = liste.types ?? [];
      if (types.length > 0) {
        embed.addFields({
          name: `Types (${types.length})`,
          value: truncate(types.map(type => `**${type.label}** — ${formaterNombre(type.count)}`).join(" · "), 1000),
        });
      }
      pied(embed, {
        note: "Les hachages de modèle ne pointent vers aucun chemin d'image extrait · azalee.rosegriffon.fr",
      });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Invocation --------------------------------------------------------

  @Slash({
    name: "invocation",
    description: "Taux d'invocation par signe : légendaire, rare, commun",
  })
  async invocation(
    @SlashOption({
      name: "signe",
      description: "Signe à détailler (laisser vide pour la vue d'ensemble)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () =>
          classerPropositions(await signesInvocation(), saisie(interaction), signe => String(signe.name ?? "")).map(
            signe => ({
              name: truncate(`${signe.name ?? "Signe"} (${signe.totalChars ?? 0})`, 100),
              value: String(signe.signNo ?? ""),
            }),
          ),
        ),
    })
    signe: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const signes = await signesInvocation();
      const embed = rgEmbed().setURL(urlWiki("/invocation"));

      if (!signe) {
        embed.setTitle(`Invocation — ${formaterNombre(signes.length)} signes`);
        embed.setDescription(
          truncate(
            signes
              .map(
                entree =>
                  `**${entree.name ?? `Signe ${entree.signNo}`}** — ${formaterNombre(entree.totalChars)} personnages`,
              )
              .join("\n"),
            3800,
          ),
        );
        pied(embed, {
          note: "Relance la commande avec l'option « signe » pour les taux détaillés · azalee.rosegriffon.fr",
        });
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const numero = Number.parseInt(signe, 10);
      const trouve =
        signes.find(entree => entree.signNo === numero) ??
        classerPropositions(signes, signe, entree => String(entree.name ?? ""), 1)[0];
      if (!trouve) {
        await interaction.editReply({ content: "❌ Signe d'invocation inconnu." });
        return;
      }

      embed.setTitle(truncate(`Invocation — ${trouve.name ?? `Signe ${trouve.signNo}`}`, 200));
      embed.setDescription(`**${formaterNombre(trouve.totalChars)}** personnages invocables sous ce signe.`);
      for (const palier of trouve.tiers ?? []) {
        embed.addFields({
          name: `${palier.label ?? "Palier"} — ${formaterPourcentage(palier.ratePct)}`,
          value: truncate(
            joindre([
              `${formaterNombre(palier.count)} personnages`,
              `soit ${formaterPourcentage(palier.perCharPct, 3)} par personnage`,
            ]),
            1000,
          ),
        });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Drops -------------------------------------------------------------

  @Slash({ name: "drops", description: "Taux de drop : coffres de victoire et émissions d'objet" })
  async drops(
    @SlashChoice(...CHOIX_SOURCE_DROP)
    @SlashOption({
      name: "source",
      description: "Origine du lot",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    source: string | undefined,
    @SlashOption({
      name: "objet",
      description: "Mots du nom de l'objet dropé",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    objet: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      await interaction.editReply(
        await rendreDrops({
          vue: "drops",
          page: 1,
          filtre: source ?? null,
          recherche: objet ?? null,
        }),
      );
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Magasins ----------------------------------------------------------

  @Slash({
    name: "magasin",
    description: "Magasins du jeu : catalogue et ventilation par catégorie",
  })
  async magasin(
    @SlashOption({
      name: "nom",
      description: "Magasin à détailler (laisser vide pour la liste des 15)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () =>
          classerPropositions(
            await magasinsConnus(),
            saisie(interaction),
            boutique => `${boutique.name ?? ""} ${boutique.nameEn ?? ""} ${boutique.nameJa ?? ""}`,
          ).map(boutique => ({
            name: truncate(`${boutique.name ?? "Magasin"} (${boutique.itemCount ?? 0} articles)`, 100),
            value: String(boutique.shopId ?? ""),
          })),
        ),
    })
    nom: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const magasins = await magasinsConnus();

      if (!nom) {
        const embed = rgEmbed()
          .setTitle(`Magasins — ${formaterNombre(magasins.length)}`)
          .setURL(urlWiki("/boutique"))
          .setDescription(
            truncate(
              magasins
                .map(boutique => `**${boutique.name ?? "Magasin"}** — ${formaterNombre(boutique.itemCount)} articles`)
                .join("\n"),
              3800,
            ),
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const identifiant = Number.parseInt(nom, 10);
      const reference =
        magasins.find(boutique => boutique.shopId === identifiant) ??
        classerPropositions(
          magasins,
          nom,
          boutique => `${boutique.name ?? ""} ${boutique.nameEn ?? ""} ${boutique.nameJa ?? ""}`,
          1,
        )[0];
      if (!reference?.shopId) {
        await interaction.editReply({ content: "❌ Magasin introuvable dans le wiki." });
        return;
      }

      const boutique = (await azalee().shop(reference.shopId)) as unknown as FicheMagasin;
      const embed = rgEmbed()
        .setTitle(truncate(String(boutique.name ?? "Magasin"), 200))
        .setURL(urlWiki(`/boutique/${encodeURIComponent(String(boutique.shopId))}`))
        .setDescription(`**${formaterNombre(boutique.itemCount)}** articles au catalogue.`);

      const autresNoms = joindre([boutique.nameEn, boutique.nameJa]);
      if (autresNoms.length > 0) {
        embed.addFields({ name: "Autres noms", value: truncate(autresNoms, 500) });
      }
      const categories = boutique.categories ?? [];
      if (categories.length > 0) {
        embed.addFields({
          name: `Catégories (${categories.length})`,
          value: truncate(
            categories
              .map(
                entree =>
                  `${libelleCategorieObjet(entree.category) ?? entree.category} (${formaterNombre(entree.count)})`,
              )
              .join(" · "),
            1000,
          ),
        });
      }

      const articles = (boutique.items ?? [])
        .map(article => String(article.name ?? "").trim())
        .filter(article => article.length > 0);
      if (articles.length > 0) {
        // Deux champs au plus : un catalogue de 547 articles ne rentre pas
        // dans un embed, et le dépassement ferait échouer l'envoi entier.
        const blocs = decouperEnChamps([articles.slice(0, 120).join(" · ")], {
          maxParChamp: 1000,
          maxChamps: 2,
        });
        blocs.forEach((bloc, index) => {
          embed.addFields({
            name: index === 0 ? `Aperçu du catalogue (${articles.length})` : "Suite",
            value: bloc,
          });
        });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Galerie -----------------------------------------------------------

  @Slash({ name: "galerie", description: "Illustrations du jeu : histoire, chroniques, télops…" })
  async galerie(
    @SlashOption({
      name: "categorie",
      description: "Catégorie d'illustration",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () =>
          classerPropositions([...CATEGORIES_GALERIE], saisie(interaction), categorie => categorie.libelle).map(
            categorie => ({
              name: `${categorie.libelle} (${categorie.total})`,
              value: categorie.valeur,
            }),
          ),
        ),
    })
    categorie: string | undefined,
    @SlashOption({
      name: "recherche",
      description: "Mots du nom de fichier de l'illustration",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    recherche: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      await interaction.editReply(
        await rendreGalerie({
          vue: "galerie",
          page: 1,
          filtre: resoudreCategorieGalerie(categorie),
          recherche: recherche ?? null,
        }),
      );
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Coordinateurs -----------------------------------------------------

  @Slash({
    name: "coordinateur",
    description: "Coordinateurs et managers : effet de banc et élément",
  })
  async coordinateur(
    @SlashOption({
      name: "nom",
      description: "Coordinateur à détailler (laisser vide pour parcourir les 102)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () => {
          const liste = (await azalee().coordinators({
            q: saisie(interaction) || undefined,
            limit: 25,
          } as never)) as unknown as Page<FichePerso>;
          return (liste.data ?? []).map(entree => ({
            name: truncate(texteFr(entree.names), 100),
            value: truncate(texteFr(entree.names), 100),
          }));
        }),
    })
    nom: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      if (!nom) {
        await interaction.editReply(
          await rendreCoordinateurs({
            vue: "coordinateur",
            page: 1,
            filtre: null,
            recherche: null,
          }),
        );
        return;
      }

      // Il n'existe PAS de route de fiche pour un coordinateur : mesuré,
      // `/api/characters/coord-55` répond 404. La liste filtrée est la seule
      // source, et elle porte déjà tout ce qu'un embed affiche.
      const liste = (await azalee().coordinators({
        q: nom,
        limit: 1,
      } as never)) as unknown as Page<FichePerso>;
      const coordinateur = (liste.data ?? [])[0];
      if (!coordinateur) {
        await interaction.editReply({ content: "❌ Introuvable dans le wiki." });
        return;
      }

      const variante = coordinateur.variants?.[0];
      const embed = rgEmbed()
        .setTitle(truncate(texteFr(coordinateur.names), 200))
        .setURL(urlWiki("/entraineur"));

      const resume = truncate(nettoyerTexteJeu(texteFr(coordinateur.descriptions, "")), 800);
      if (resume.length > 0) {
        embed.setDescription(resume);
      }
      const identite = joindre([
        // `/api/coordinators` sert le rôle ET l'élément en anglais (mesuré sur
        // les 102 lignes), à la différence de `/api/characters`.
        variante?.rarity ? `Rôle **${libelleRoleCoordinateur(variante.rarity)}**` : null,
        variante?.element ? `Élément **${resoudreElement(variante.element) ?? variante.element}**` : null,
        coordinateur.series ? `Série **${coordinateur.series}**` : null,
        coordinateur.internalCode ? `Code \`${coordinateur.internalCode}\`` : null,
      ]);
      if (identite.length > 0) {
        embed.addFields({ name: "Identité", value: truncate(identite, 1000) });
      }

      const portrait = await illustrationProuvee(variante?.image ?? coordinateur.image, 200);
      if (portrait) {
        embed.setThumbnail(portrait);
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  // --- Pagination des listes ---------------------------------------------

  /**
   * Boutons de pagination des trois vues de liste (galerie, drops,
   * coordinateurs). Tout l'état tient dans le `customId` : aucune mémoire de
   * processus, donc un redémarrage du bot ne laisse jamais de bouton mort.
   */
  @ButtonComponent({ id: /^az\|/ })
  async paginer(interaction: ButtonInteraction) {
    const etat = decoderEtatListe(interaction.customId);
    const rendre = etat ? VUES_PAGINEES[etat.vue] : undefined;
    if (!etat || !rendre) {
      await interaction.reply({
        content: "Pagination illisible — relance la commande `/azalee`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    try {
      await interaction.editReply(await rendre(etat));
    } catch (err) {
      console.error("[azalee] pagination :", err);
      await interaction.followUp({
        content: `❌ ${messageErreurAzalee(err)}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
