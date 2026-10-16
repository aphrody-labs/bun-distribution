/**
 * `/cpk` — les 250 800 fichiers extraits des archives CPK d'IEVR dans Discord.
 *
 *  - `/cpk parcourir` : l'arborescence, dossier par dossier, paginée ;
 *  - `/cpk chercher`  : un motif cherché dans les 250 800 chemins ;
 *  - `/cpk fichier`   : la fiche d'un fichier, avec un APERÇU de son contenu.
 *
 * ── D'OÙ VIENNENT LES DONNÉES ──────────────────────────────────────────────
 * L'INDEX (qui existe, où, dans quelle archive) vient de l'API Azalée en boucle
 * locale, via le client typé de `lib/azalee.ts` : `cpkList` → `/api/cpk`,
 * `cpkSearch` → `/api/cpk/search`, `cpkFile` → `/api/cpk/file`.
 *
 * Le CONTENU, lui, n'est jamais dans l'index : il est décodé EN DIRECT depuis
 * les CPK par le CDN. C'est tout l'intérêt de la commande — un `g4tx` devient
 * une image, un `g4md` un modèle glTF assemblé (corps + visage + uniforme), un
 * `cfg.bin` du JSON. Les URL sont fabriquées par `lib/cpk-format.ts`, qui
 * délègue aux fabricants de la bibliothèque : le bot et le wiki montrent la
 * même chose ou ne montrent rien.
 *
 * ── CE QUI A ÉTÉ MESURÉ LE 13/8/2026, ET QUI DICTE LE CODE ─────────────────
 *  - Une illustration de galerie en PNG brut pèse **12 176 145 octets** ; la
 *    même en `?w=800&format=webp` en pèse **80 672**. Un embed ne pointe donc
 *    QUE la variante bornée.
 *  - `/model-full/c05021090.glb` répond 200 (175 072 o) mais
 *    `/model-full/ear001.glb` répond **404** : tous les modèles ne sont pas
 *    assemblables. La fiche SONDE avant d'annoncer quoi que ce soit.
 *  - `/cfg/<chemin>.json` peut peser **4 079 928 octets** → lecture bornée.
 *  - **HEAD ne suffit jamais à conclure.** `/cfg/`, `/raw/` et `/model-full/`
 *    répondent **405** dès que nginx ne trouve pas le fichier sur disque :
 *    `HEAD /model-full/c11010034.glb` → 405 alors que `GET` du même → 200,
 *    `model/gltf-binary`, 70 936 octets. Seuls 5 655 des 15 533 codes de
 *    modèle de l'index ont un GLB pré-posé ; conclure sur un 405 ferait donc
 *    annoncer « pas de modèle » sur près des deux tiers de l'index. Le sondage
 *    retombe donc sur un `GET` dont le corps est relâché (cf. `methodeRefusee`).
 */
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
  type AutocompleteInteraction,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type InteractionEditReplyOptions,
  MessageFlags,
} from "discord.js";

import type { AzaleeRequestOptions } from "@rosegriffon/azalee/remote";

import { azalee, isAzaleeNotFound, messageErreurAzalee, urlWiki } from "../lib/azalee";
import { cached } from "../lib/cache";
import { rgEmbed, truncate } from "../lib/embeds";
import {
  type ApercuCpk,
  apercuCpk,
  bornerOffset,
  cheminParent,
  cheminWiki,
  correspondPrefixe,
  type CpkDir,
  type CpkFile,
  decoderParcours,
  decoderRecherche,
  decouperSaisieDossier,
  encoderParcours,
  encoderRecherche,
  ENTREES_PAR_PAGE,
  entierLisible,
  estRacine,
  extraitConfig,
  liensContenu,
  ligneAriane,
  ligneDossier,
  ligneFichier,
  ligneResultat,
  MAX_VALEUR_AUTOCOMPLETION,
  methodeRefusee,
  MOTIF_MINIMUM,
  nombreDePages,
  nomPieceJointe,
  normaliserChemin,
  numeroPage,
  OCTETS_APERCU_CONFIG,
  octetsLisibles,
  PLAFOND_RECHERCHE,
  PREFIXE_BOUTON_PARCOURS,
  PREFIXE_BOUTON_RECHERCHE,
  RESULTATS_PAR_PAGE,
  resumerConfig,
  tientEnPieceJointe,
  tranchePage,
} from "../lib/cpk-format";
import { echec, pied, rangeePagination, repondre } from "../lib/ui";

// ─── Accès aux données, mis en cache ────────────────────────────────────────

/** Durée de cache de l'index : il ne bouge qu'à une nouvelle extraction du jeu. */
const TTL_INDEX_MS = 10 * 60 * 1000;

/** Durée de cache d'un sondage CDN (le décodage est en cache disque côté CDN). */
const TTL_SONDE_MS = 10 * 60 * 1000;

/** Délai maximal accordé au CDN pour une image ou une config — au-delà, on rend la fiche sans l'aperçu. */
const DELAI_CDN_MS = 6_000;

/**
 * Délai accordé à l'assemblage d'un modèle 3D.
 *
 * Un GLB absent du disque est reconstruit depuis les CPK (géométrie + textures
 * BC1-7 converties) : c'est sans commune mesure avec un décodage de texture, et
 * 6 s suffiraient tout juste aux modèles déjà posés. `/cdn modele` retient le
 * même budget. Discord laisse 15 min après `deferReply`, la marge est gratuite.
 */
const DELAI_MODELE_MS = 90_000;

/**
 * Contraintes des appels d'autocomplétion.
 *
 * Discord n'accorde que 3 s à une suggestion : les 4 tentatives et les 8 s du
 * client partagé (calibrées, elles, sur la rotation nocturne de
 * `azalee-api.service`) laisseraient le champ figé sur « chargement… ». Une
 * suggestion ratée n'a aucune conséquence — le membre peut taper le chemin.
 */
const APPEL_AUTOCOMPLETION = { attempts: 1, timeoutMs: 1_500 } as const;

/** Squelette d'un dossier : ses sous-dossiers (toujours complets) et son nombre de fichiers. */
interface SqueletteDossier {
  dir: string;
  dirs: CpkDir[];
  fileTotal: number;
}

/**
 * Sous-dossiers + nombre de fichiers d'un dossier.
 *
 * `/api/cpk` renvoie TOUJOURS la totalité des sous-dossiers et ne pagine que
 * les fichiers : on demande donc une seule ligne de fichiers ici, et la vraie
 * tranche est demandée ensuite, une fois la découpe connue.
 */
async function squeletteDossier(chemin: string, options?: AzaleeRequestOptions): Promise<SqueletteDossier> {
  // La clé de cache ignore `options` : c'est la MÊME donnée, seul le budget de
  // patience change selon l'appelant (commande ou autocomplétion).
  return cached(`cpk:dir:${chemin}`, TTL_INDEX_MS, async () => {
    const listing = await azalee().cpkList({ path: chemin, limit: 1, offset: 0 }, options);
    return { dir: listing.dir, dirs: listing.dirs, fileTotal: listing.fileTotal };
  });
}

/** Tranche de fichiers directs d'un dossier. */
async function fichiersDossier(chemin: string, offset: number, limite: number): Promise<CpkFile[]> {
  if (limite <= 0) {
    return [];
  }
  return cached(`cpk:files:${chemin}:${offset}:${limite}`, TTL_INDEX_MS, async () => {
    const listing = await azalee().cpkList({ path: chemin, limit: limite, offset });
    return listing.files;
  });
}

/** Résultats d'une recherche de chemin, plafonnés et mis en cache. */
async function chercherFichiers(motif: string): Promise<CpkFile[]> {
  return cached(`cpk:search:${motif.toLowerCase()}`, TTL_INDEX_MS, async () =>
    azalee().cpkSearch({ q: motif, limit: PLAFOND_RECHERCHE }),
  );
}

/**
 * Vrai si le chemin désigne un FICHIER de l'index, pas un dossier.
 *
 * `/api/cpk` répond « dossier vide » aussi bien pour un dossier réellement vide
 * que pour un chemin de fichier : seule `/api/cpk/file` sait trancher, et elle
 * répond 404 sur un chemin inconnu. Une panne de l'API ne doit pas être lue
 * comme « ce n'est pas un fichier » — d'où la distinction entre l'absence
 * (`isAzaleeNotFound`) et le reste, qui est relancé à l'appelant.
 */
async function estUnFichier(chemin: string): Promise<boolean> {
  try {
    await cached(`cpk:file:${chemin}`, TTL_INDEX_MS, async () => azalee().cpkFile(chemin));
    return true;
  } catch (err) {
    if (isAzaleeNotFound(err)) {
      return false;
    }
    throw err;
  }
}

/** Nombre total de fichiers indexés, tel que l'API le rapporte. */
async function totalIndexe(): Promise<number | null> {
  try {
    return await cached("cpk:total", TTL_INDEX_MS, async () => {
      const sante = await azalee().health();
      return sante.cpkFiles;
    });
  } catch {
    // Un pied de page décoratif ne fait pas échouer une commande.
    return null;
  }
}

// ─── Sondage du CDN ─────────────────────────────────────────────────────────

/** Ce qu'un sondage d'en-têtes apprend d'un contenu décodé par le CDN. */
interface SondeContenu {
  statut: number;
  octets: number | null;
  type: string | null;
}

/**
 * Interroge une URL et n'en garde QUE les en-têtes.
 *
 * Le corps est relâché sans être lu : `content-length` et `content-type` sont
 * déjà là, et un GLB froid ou un PNG de galerie pèsent plusieurs mégaoctets
 * qu'il serait absurde de faire transiter pour afficher une taille.
 */
async function interrogerContenu(url: string, methode: "HEAD" | "GET", delaiMs: number): Promise<SondeContenu> {
  const reponse = await fetch(url, { method: methode, signal: AbortSignal.timeout(delaiMs) });
  await reponse.body?.cancel().catch(() => undefined);
  const longueur = Number.parseInt(reponse.headers.get("content-length") ?? "", 10);
  return {
    statut: reponse.status,
    octets: Number.isFinite(longueur) ? longueur : null,
    type: reponse.headers.get("content-type"),
  };
}

/**
 * Sonde un contenu décodé.
 *
 * On tente HEAD d'abord — c'est gratuit pour le CDN quand il l'accepte (une
 * variante `?w=` répond 200 même à froid). Mais `/model-full/`, `/cfg/` et
 * `/raw/` répondent **405** dès que nginx ne trouve pas le fichier sur disque :
 * ce refus de MÉTHODE ne dit rien de l'existence du contenu, et le lire comme
 * une absence ferait annoncer « pas de modèle » sur les deux tiers de l'index
 * (mesuré : `HEAD /model-full/c11010034.glb` → 405, `GET` → 200, 70 936 o).
 * On retombe donc sur un GET dont le corps est immédiatement relâché.
 */
async function sonderContenu(url: string, delaiMs = DELAI_CDN_MS): Promise<SondeContenu | null> {
  try {
    return await cached(`cpk:sonde:${url}`, TTL_SONDE_MS, async () => {
      const tete = await interrogerContenu(url, "HEAD", delaiMs);
      return methodeRefusee(tete.statut) ? await interrogerContenu(url, "GET", delaiMs) : tete;
    });
  } catch {
    return null;
  }
}

/** Corps distant lu partiellement, avec le drapeau qui dit s'il est entier. */
interface CorpsBorne {
  texte: string;
  complet: boolean;
}

/**
 * Lit un corps distant en s'arrêtant à `maxOctets`.
 *
 * Un `/cfg/*.json` peut peser 4 Mo : le télécharger en entier pour n'en montrer
 * que 900 caractères gaspillerait la bande passante du VPS et pourrait faire
 * expirer l'interaction. On coupe le flux dès la limite atteinte.
 */
async function lireCorpsBorne(url: string, maxOctets: number): Promise<CorpsBorne | null> {
  try {
    const reponse = await fetch(url, { signal: AbortSignal.timeout(DELAI_CDN_MS) });
    if (!reponse.ok || !reponse.body) {
      return null;
    }
    const lecteur = reponse.body.getReader();
    const decodeur = new TextDecoder("utf-8");
    let texte = "";
    let lus = 0;
    let complet = true;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) {
        break;
      }
      if (value) {
        lus += value.byteLength;
        texte += decodeur.decode(value, { stream: true });
      }
      if (lus >= maxOctets) {
        complet = false;
        await lecteur.cancel();
        break;
      }
    }
    texte += decodeur.decode();
    return { texte, complet };
  } catch {
    return null;
  }
}

// ─── Rendu : parcours d'un dossier ──────────────────────────────────────────

/**
 * Boutons d'une pagination, ou rien si une seule page.
 *
 * Les deux identifiants attendus sont ceux des pages VOISINES ; la trousse
 * reconstruit elle-même les sauts de bout de liste à partir de `identifiant`,
 * qu'on lui donne sous la forme d'une fonction de page.
 */
function boutonsPagination(
  prefixe: string,
  identifiant: (page: number) => string | null,
  page: number,
  pages: number,
): Array<ActionRowBuilder<ButtonBuilder>> {
  return rangeePagination({ prefixe, page, pages, identifiant });
}

/** Construit la réponse d'une page de `/cpk parcourir`. */
async function rendreParcours(chemin: string, offsetDemande: number): Promise<InteractionEditReplyOptions> {
  const propre = normaliserChemin(chemin);
  const squelette = await squeletteDossier(propre);
  const total = squelette.dirs.length + squelette.fileTotal;

  const embed = rgEmbed()
    .setTitle(truncate(`📦 ${ligneAriane(squelette.dir)}`, 250))
    .setURL(urlWiki(cheminWiki(squelette.dir)));

  if (total === 0) {
    // Un dossier sans contenu, dans un index de 250 800 fichiers, veut presque
    // toujours dire l'une de deux choses : c'est un FICHIER (le membre a collé
    // un chemin complet), ou le chemin est faux. On tranche au lieu de deviner.
    if (await estUnFichier(propre)) {
      embed.setDescription(
        [
          `\`${truncate(propre, 200)}\` est un fichier, pas un dossier.`,
          "",
          `Ouvrez sa fiche avec \`/cpk fichier chemin:${truncate(propre, 200)}\`.`,
        ].join("\n"),
      );
      return { embeds: [embed], components: [] };
    }
    const parent = cheminParent(propre);
    embed.setDescription(
      [
        `Aucun contenu sous \`${truncate(propre === "" ? "data" : propre, 200)}\`.`,
        "",
        "Tous les chemins de l'index commencent par `data/` et se répartissent entre",
        "`data/common` et `data/dx11`. Essayez `/cpk parcourir` sans argument pour partir",
        "de la racine, ou `/cpk chercher` si vous cherchez un nom de fichier.",
        parent === "" ? "" : `\nDossier parent : \`${parent}\``,
      ].join("\n"),
    );
    return { embeds: [embed], components: [] };
  }

  const offset = bornerOffset(offsetDemande, total, ENTREES_PAR_PAGE);
  const tranche = tranchePage(squelette.dirs.length, squelette.fileTotal, offset, ENTREES_PAR_PAGE);
  const fichiers = await fichiersDossier(propre, tranche.offsetFichiers, tranche.limiteFichiers);

  const lignes = [
    ...squelette.dirs.slice(tranche.debutDossiers, tranche.finDossiers).map(ligneDossier),
    ...fichiers.map(ligneFichier),
  ];
  embed.setDescription(truncate(lignes.join("\n"), 4_000));

  const pages = nombreDePages(total, ENTREES_PAR_PAGE);
  const page = numeroPage(offset, ENTREES_PAR_PAGE);
  embed.addFields({
    name: "Contenu du dossier",
    value: [
      `${entierLisible(squelette.dirs.length)} sous-dossier${squelette.dirs.length > 1 ? "s" : ""}`,
      `${entierLisible(squelette.fileTotal)} fichier${squelette.fileTotal > 1 ? "s" : ""} direct${squelette.fileTotal > 1 ? "s" : ""}`,
    ].join(" · "),
  });
  if (!estRacine(propre)) {
    embed.addFields({
      name: "Descendre / remonter",
      value: [
        "`/cpk parcourir chemin:<dossier>` pour entrer dans un sous-dossier,",
        "`/cpk fichier chemin:<chemin complet>` pour ouvrir une fiche.",
        `Parent : \`${cheminParent(propre) || "data"}\``,
      ].join("\n"),
    });
  }
  pied(embed, { page: page, pages: pages });

  return {
    embeds: [embed],
    components: boutonsPagination(
      PREFIXE_BOUTON_PARCOURS,
      cible => encoderParcours({ chemin: propre, offset: (cible - 1) * ENTREES_PAR_PAGE }),
      page,
      pages,
    ),
  };
}

// ─── Rendu : recherche ──────────────────────────────────────────────────────

/** Construit la réponse d'une page de `/cpk chercher`. */
async function rendreRecherche(motif: string, offsetDemande: number): Promise<InteractionEditReplyOptions> {
  const propre = motif.trim();
  const embed = rgEmbed().setTitle(`🔎 Fichiers du jeu — « ${truncate(propre, 100)} »`);

  if (propre.length < MOTIF_MINIMUM) {
    embed.setDescription(`Il faut au moins ${MOTIF_MINIMUM} caractères pour chercher dans les 250 800 chemins.`);
    return { embeds: [embed], components: [] };
  }

  const resultats = await chercherFichiers(propre);
  if (resultats.length === 0) {
    embed.setDescription(
      [
        "Aucun fichier ne contient ce motif dans son chemin.",
        "",
        "La recherche porte sur le CHEMIN COMPLET : un nom de dossier fonctionne",
        "(`telop_waza`, `gallery_img2`), une extension aussi (`.g4md`).",
      ].join("\n"),
    );
    return { embeds: [embed], components: [] };
  }

  const offset = bornerOffset(offsetDemande, resultats.length, RESULTATS_PAR_PAGE);
  const page = numeroPage(offset, RESULTATS_PAR_PAGE);
  const pages = nombreDePages(resultats.length, RESULTATS_PAR_PAGE);

  embed.setDescription(
    truncate(
      resultats
        .slice(offset, offset + RESULTATS_PAR_PAGE)
        .map(ligneResultat)
        .join("\n"),
      4_000,
    ),
  );
  embed.addFields({
    name: "Ouvrir un résultat",
    value: "`/cpk fichier chemin:<chemin complet>` — l'autocomplétion propose les chemins.",
  });
  if (resultats.length >= PLAFOND_RECHERCHE) {
    // Dire la troncature : sans ça, « 200 résultats » se lit comme un total.
    embed.addFields({
      name: "Résultats tronqués",
      value: `Le motif en renvoie au moins ${entierLisible(PLAFOND_RECHERCHE)} ; affinez-le pour voir le reste.`,
    });
  }
  pied(embed, {
    page,
    pages,
    note: `${entierLisible(resultats.length)} résultat${resultats.length > 1 ? "s" : ""}`,
  });

  return {
    embeds: [embed],
    components: boutonsPagination(
      PREFIXE_BOUTON_RECHERCHE,
      cible => encoderRecherche({ motif: propre, offset: (cible - 1) * RESULTATS_PAR_PAGE }),
      page,
      pages,
    ),
  };
}

// ─── Rendu : fiche d'un fichier ─────────────────────────────────────────────

/** Aperçu d'une texture : on ne pose l'image que si le CDN sait la décoder. */
async function garnirImage(embed: EmbedBuilder, image: string, original: string): Promise<void> {
  const sonde = await sonderContenu(image);
  if (sonde !== null && sonde.statut === 200) {
    embed.setImage(image);
    embed.addFields({
      name: "Aperçu",
      value: [
        `Image décodée en direct depuis le CPK — ${octetsLisibles(sonde.octets)} en ${
          sonde.type ?? "format inconnu"
        }, redimensionnée pour tenir dans un message.`,
        `[Résolution d'origine](${original}) — non redimensionnée, jusqu'à 12 Mo.`,
      ].join("\n"),
    });
    return;
  }
  embed.addFields({
    name: "Aperçu",
    value: ["Le CDN n'a pas su décoder cette texture en image.", `[Octets bruts](${original})`].join("\n"),
  });
}

/** Aperçu d'un modèle : pièce jointe si elle tient, lien sinon. */
async function garnirModele(embed: EmbedBuilder, apercu: ApercuCpk): Promise<AttachmentBuilder | null> {
  const glb = apercu.contenu;
  const sonde = await sonderContenu(glb, DELAI_MODELE_MS);
  if (sonde === null || sonde.statut !== 200) {
    embed.addFields({
      name: "Modèle 3D",
      value: [
        "Ce fichier n'est pas assemblable en glTF complet (visage, uniforme ou accessoire",
        "servi seul) — le CDN répond en échec sur `/model-full/`.",
        "Le navigateur du wiki sait, lui, l'assembler dans son viewer 3D.",
        `[Octets bruts du CPK](${apercu.brut})`,
      ].join("\n"),
    });
    return null;
  }

  const taille = octetsLisibles(sonde.octets);
  if (sonde.octets !== null && tientEnPieceJointe(sonde.octets)) {
    const octets = await telechargerBorne(glb, DELAI_MODELE_MS);
    if (octets !== null) {
      embed.addFields({
        name: "Modèle 3D",
        value: `glTF binaire assemblé en direct (corps + visage + uniforme texturés) — ${taille}, joint à ce message.`,
      });
      return new AttachmentBuilder(octets, { name: nomPieceJointe(glb, "modele.glb") });
    }
  }
  embed.addFields({
    name: "Modèle 3D",
    value: [
      `glTF binaire assemblé en direct — ${taille}, au-delà de ce qu'un message peut porter.`,
      `[Télécharger le modèle](${glb})`,
    ].join("\n"),
  });
  return null;
}

/** Aperçu d'une config binaire : résumé structuré + extrait borné. */
async function garnirConfig(embed: EmbedBuilder, json: string): Promise<void> {
  const corps = await lireCorpsBorne(json, OCTETS_APERCU_CONFIG);
  if (corps === null) {
    embed.addFields({
      name: "Décodage",
      value: `Le CDN n'a pas rendu de JSON pour ce fichier.\n[Octets bruts](${json})`,
    });
    return;
  }

  if (corps.complet) {
    try {
      const resume = resumerConfig(JSON.parse(corps.texte));
      if (resume !== null) {
        embed.addFields({ name: "Structure", value: truncate(resume, 1_000) });
      }
    } catch {
      // Un JSON illisible ne prive pas de l'extrait brut ci-dessous.
    }
  }

  embed.addFields({
    name: corps.complet ? "Extrait du décodage" : "Extrait du décodage (tronqué)",
    value: truncate(extraitConfig(corps.texte, corps.complet), 1_020),
  });
  embed.addFields({ name: "JSON complet", value: `[Ouvrir le décodage](${json})` });
}

/** Télécharge un contenu en refusant tout ce qui dépasse le seuil de pièce jointe. */
async function telechargerBorne(url: string, delaiMs = DELAI_CDN_MS): Promise<Buffer | null> {
  try {
    const reponse = await fetch(url, { signal: AbortSignal.timeout(delaiMs) });
    if (!reponse.ok) {
      return null;
    }
    const octets = Buffer.from(await reponse.arrayBuffer());
    return tientEnPieceJointe(octets.byteLength) ? octets : null;
  } catch {
    return null;
  }
}

// ─── Autocomplétion ─────────────────────────────────────────────────────────

/** Réponse d'autocomplétion tolérante : une API muette ne doit pas figer la saisie. */
async function repondreSuggestions(
  interaction: AutocompleteInteraction,
  produire: () => Promise<Array<{ name: string; value: string }>>,
): Promise<void> {
  try {
    const choix = await produire();
    await interaction.respond(
      choix
        .filter(c => c.value.length > 0 && c.value.length <= MAX_VALEUR_AUTOCOMPLETION)
        .slice(0, 25)
        .map(c => ({ name: truncate(c.name, 100), value: c.value })),
    );
  } catch {
    await interaction.respond([]);
  }
}

/** Saisie courante de l'option en cours d'autocomplétion. */
function saisie(interaction: AutocompleteInteraction): string {
  const valeur = interaction.options.getFocused();
  return typeof valeur === "string" ? valeur : String(valeur ?? "");
}

// ─── Commandes ──────────────────────────────────────────────────────────────

@Discord()
@SlashGroup({
  name: "cpk",
  description: "Les 250 800 fichiers extraits des archives du jeu, décodés en direct",
})
@SlashGroup("cpk")
export class CpkCommand {
  @Slash({
    name: "parcourir",
    description: "Parcourt l'arborescence des fichiers du jeu, dossier par dossier",
  })
  async parcourir(
    @SlashOption({
      name: "chemin",
      description: "Dossier à ouvrir (vide = la racine)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () => {
          const { parent, filtre } = decouperSaisieDossier(saisie(interaction));
          const squelette = await squeletteDossier(parent, APPEL_AUTOCOMPLETION);
          return squelette.dirs
            .filter(dossier => correspondPrefixe(dossier.name, filtre))
            .map(dossier => ({
              name: `${dossier.name}/ — ${entierLisible(dossier.count)} fichiers`,
              value: `${squelette.dir}/${dossier.name}`,
            }));
        }),
    })
    chemin: string | undefined,
    @SlashOption({
      name: "page",
      description: "Numéro de page",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
    })
    page: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      await interaction.editReply(await rendreParcours(chemin ?? "", ((page ?? 1) - 1) * ENTREES_PAR_PAGE));
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  @Slash({
    name: "chercher",
    description: "Cherche un motif dans les 250 800 chemins de fichiers du jeu",
  })
  async chercher(
    @SlashOption({
      name: "motif",
      description: "Fragment de chemin, de dossier ou de nom (2 caractères minimum)",
      type: ApplicationCommandOptionType.String,
      required: true,
      minLength: MOTIF_MINIMUM,
    })
    motif: string,
    @SlashOption({
      name: "page",
      description: "Numéro de page",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
    })
    page: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      await interaction.editReply(await rendreRecherche(motif, ((page ?? 1) - 1) * RESULTATS_PAR_PAGE));
    } catch (err) {
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  @Slash({
    name: "fichier",
    description: "Fiche d'un fichier du jeu : archive d'origine, type et aperçu du contenu",
  })
  async fichier(
    @SlashOption({
      name: "chemin",
      description: "Chemin complet du fichier dans l'index",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        repondreSuggestions(interaction, async () => {
          const texte = saisie(interaction).trim();
          if (texte.length < MOTIF_MINIMUM) {
            return [];
          }
          const trouves = await azalee().cpkSearch({ q: texte, limit: 25 }, APPEL_AUTOCOMPLETION);
          return trouves.map(fichier => ({
            name: fichier.path,
            value: fichier.path,
          }));
        }),
    })
    chemin: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    const propre = normaliserChemin(chemin);
    try {
      const meta = await azalee().cpkFile(propre);
      const apercu = apercuCpk({ path: meta.path, ext: meta.ext });

      const embed = rgEmbed()
        .setTitle(truncate(meta.name, 250))
        .setURL(urlWiki(cheminWiki(meta.path)))
        .setDescription(`\`${truncate(meta.path, 3_000)}\``);

      embed.addFields(
        { name: "Type", value: `${apercu.libelle} (\`.${meta.ext}\`)`, inline: true },
        { name: "Dossier", value: `\`${truncate(meta.dir, 1_000)}\``, inline: true },
        { name: "Archive CPK", value: `\`${truncate(meta.cpk, 1_000)}\``, inline: false },
      );

      let piece: AttachmentBuilder | null = null;
      if (apercu.famille === "image" && apercu.image !== null) {
        await garnirImage(embed, apercu.image, apercu.contenu);
      } else if (apercu.modele3d) {
        piece = await garnirModele(embed, apercu);
      } else if (apercu.configJson) {
        await garnirConfig(embed, apercu.contenu);
      } else {
        embed.addFields({ name: "Contenu", value: truncate(liensContenu(apercu), 1_000) });
      }

      const total = await totalIndexe();
      pied(embed, {
        note: total === null ? null : `${entierLisible(total)} fichiers indexés`,
      });

      await interaction.editReply(piece === null ? { embeds: [embed] } : { embeds: [embed], files: [piece] });
    } catch (err) {
      if (isAzaleeNotFound(err)) {
        await interaction.editReply({
          content: [
            `Aucun fichier à \`${truncate(propre, 200)}\`.`,
            "C'est peut-être un dossier : `/cpk parcourir` l'ouvrira.",
          ].join("\n"),
        });
        return;
      }
      await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
    }
  }

  /**
   * Boutons de `/cpk parcourir`. Tout l'état tient dans le `customId` : aucune
   * mémoire de processus, donc un redémarrage du bot ne laisse jamais de
   * boutons morts.
   */
  @ButtonComponent({ id: /^cpkd\|/ })
  async paginerParcours(interaction: ButtonInteraction) {
    const etat = decoderParcours(interaction.customId);
    if (etat === null) {
      await interaction.reply({
        content: "Pagination illisible.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    try {
      await interaction.editReply(await rendreParcours(etat.chemin, etat.offset));
    } catch (err) {
      await interaction.followUp({
        content: `❌ ${messageErreurAzalee(err)}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /** Boutons de `/cpk chercher`, même principe. */
  @ButtonComponent({ id: /^cpkq\|/ })
  async paginerRecherche(interaction: ButtonInteraction) {
    const etat = decoderRecherche(interaction.customId);
    if (etat === null) {
      await interaction.reply({
        content: "Pagination illisible.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    try {
      await interaction.editReply(await rendreRecherche(etat.motif, etat.offset));
    } catch (err) {
      await interaction.followUp({
        content: `❌ ${messageErreurAzalee(err)}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
