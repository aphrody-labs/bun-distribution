/**
 * Tests du noyau pur des sondages et des campagnes.
 *
 * Aucun accès base, aucun accès réseau : tout ce qui est ici se décide sans
 * Postgres. Les jeux d'essai reprennent des lignes RÉELLES mesurées le
 * 13/8/2026 (sondage `3e501896`, campagne `inazuma-day-2026`), pas des valeurs
 * inventées : une régression de format doit se voir sur les vraies données.
 *
 * Le dernier bloc est un contrôle de NON-DÉRIVE sur la vie privée : il balaie
 * les trois fichiers de cette unité et échoue si le nom de la table des votes
 * nominatifs y apparaît, ne serait-ce qu'en commentaire.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aDesResultats,
  barre,
  bornerPage,
  CHEMIN_ASSETS,
  cheminCampagne,
  classement,
  couper,
  decimal,
  decoderEtatCampagnes,
  decoderEtatSondages,
  echapperMarkdown,
  encoderEtatCampagnes,
  encoderEtatSondages,
  entier,
  estEstimation,
  estIdentifiantSondage,
  estSlugCampagne,
  estUrlDiscordSignee,
  etatCampagne,
  etatSondage,
  formaterNombre,
  formaterPourcentage,
  gagnant,
  hashtagsAffichables,
  horodatageDate,
  imagePost,
  libelleChoixAutorises,
  libelleEtat,
  libelleEtatCampagne,
  libelleParticipation,
  libelleStatut,
  lienMessageSondage,
  lienPost,
  ligneListeCampagne,
  ligneListeSondage,
  ligneMetriques,
  ligneParticipations,
  ligneResultat,
  marqueurSource,
  MAX_CUSTOM_ID,
  mentionSource,
  nombreDePages,
  normaliserCampagne,
  normaliserPeriode,
  normaliserSondage,
  normaliserStatut,
  noteCampagneVide,
  periodeCampagne,
  pluriel,
  pourcentage,
  texteTitre,
  urlAsset,
  urlImageRepubliable,
  versDate,
  type LigneCampagne,
  type LigneSondage,
  type OptionSondage,
  type StatsCampagne,
} from "./sondage-format";

const ORIGINE = "https://rosegriffon.fr";

/** Espaces fines insécables d'`Intl` → espace ordinaire, pour comparer du texte. */
function normaliserEspaces(valeur: string): string {
  return valeur.replace(/\s+/g, " ");
}

/**
 * Sondage `3e501896` tel qu'il est en base (extrait réel du 13/8/2026) : encart
 * complet, décompte OFFICIEL, 120 votes de 67 participants, 8 choix.
 */
const LIGNE_OFFICIELLE: LigneSondage = {
  channel_id: "1136706802579411025",
  command: "/poll",
  created_at: "2026-07-29T16:54:27.082Z",
  creator_username: "yoyo",
  ended: true,
  ends_at: "2026-08-05T16:49:00.000Z",
  guild_id: "1136706801912516608",
  language: "fr",
  locked: true,
  max_choices: 3,
  message_id: "1532068756304433290",
  options: [
    {
      emoji: "🥞",
      label: "Goldie Lemmon / Nanobana Kinako",
      percentage: 20.8,
      position: 0,
      votes: 25,
    },
    { emoji: "🌸", label: "Shinohara Raika", percentage: 25.8, position: 1, votes: 31 },
    { emoji: "🐰", label: "Fei Rune", percentage: 11.7, position: 2, votes: 14 },
    { emoji: "🕵️", label: "Tori Vanguard / Zaizen Touko", percentage: 7.5, position: 3, votes: 9 },
  ],
  poll_id: "3e501896",
  provider: "easypoll",
  question: "Quel personnage irait le mieux pour cette émote (visuel ci-dessous) ?",
  results_hidden: false,
  source: "embed",
  total_voters: 67,
  total_votes: 120,
  visual_alt: null,
  visual_height: 1080,
  visual_path: "discord/sondages/3e501896/1532068756304433293.png",
  visual_width: 1920,
};

/**
 * Sondage `a15eba3c` : décompte RECONSTITUÉ depuis les réactions archivées.
 * Ni clôture, ni date de fin, ni nombre de participants — c'est exactement ce
 * que la base contient pour les 25 sondages de 2023-2024.
 */
const LIGNE_ESTIMEE: LigneSondage = {
  channel_id: "1136706802579411025",
  command: null,
  created_at: "2024-04-01T18:00:00.000Z",
  creator_username: null,
  ended: false,
  ends_at: null,
  guild_id: "1136706801912516608",
  language: "en",
  locked: false,
  max_choices: 1,
  message_id: null,
  options: [
    {
      emoji: "🌸",
      label: "Cerise Blossom / Nozaki Sakura",
      percentage: null,
      position: 0,
      votes: 11,
    },
    { emoji: "🟣", label: "Tezcat / Shuu", percentage: null, position: 1, votes: 50 },
    { emoji: "🐰", label: "Fey Rune", percentage: null, position: 2, votes: 42 },
  ],
  poll_id: "a15eba3c",
  provider: "easypoll",
  question: "Quel personnage aimeriez-vous voir incarner cette émote ?",
  results_hidden: true,
  source: "reactions",
  total_voters: null,
  total_votes: 192,
  visual_alt: null,
  visual_height: null,
  visual_path: null,
  visual_width: null,
};

/** Campagne `inazuma-day-2026`, active, deux hashtags dont un japonais. */
const LIGNE_CAMPAGNE: LigneCampagne = {
  actif: true,
  collecte_le: "2026-08-13T05:20:58.299Z",
  debut_le: "2026-08-05T00:00:00.000Z",
  description: "Un mois pour célébrer Inazuma Eleven.",
  fin_le: "2026-08-31T23:59:59.000Z",
  hashtags: ["inazumaday", "8月22日はイナイレの日"],
  hashtags_affichage: ["InazumaDay"],
  image_affiche: null,
  image_couverture: null,
  principale: false,
  salons_depot: [],
  slug: "inazuma-day-2026",
  sur_titre: null,
  titre: "Inazuma Day 2026",
};

describe("normalisation des valeurs base", () => {
  test("entier accepte les bigint rendus en chaîne par Bun.SQL", () => {
    // `sum((metrics->>'like_count')::bigint)` revient en `"14098"` (mesuré).
    expect(entier("14098")).toBe(14098);
    expect(entier(464)).toBe(464);
    expect(entier(12n)).toBe(12);
    expect(entier(null)).toBeNull();
    expect(entier("")).toBeNull();
    expect(entier("abc")).toBeNull();
    expect(entier(Number.NaN)).toBeNull();
  });

  test("decimal garde la partie fractionnaire d'un numeric", () => {
    expect(decimal("20.80")).toBe(20.8);
    expect(decimal(7.5)).toBe(7.5);
    expect(decimal(null)).toBeNull();
  });

  test("versDate refuse une date invalide plutôt que de rendre Invalid Date", () => {
    expect(versDate("2026-08-13T04:22:11.000Z")?.getUTCFullYear()).toBe(2026);
    expect(versDate("pas une date")).toBeNull();
    expect(versDate(null)).toBeNull();
  });

  test("formaterNombre groupe à la française et supporte l'absence", () => {
    expect(normaliserEspaces(formaterNombre(321_263))).toBe("321 263");
    expect(formaterNombre(null)).toBe("—");
  });

  test("pluriel accorde sur 1", () => {
    expect(pluriel(1, "vote", "votes")).toBe("vote");
    expect(pluriel(0, "vote", "votes")).toBe("votes");
    expect(pluriel(464, "vote", "votes")).toBe("votes");
  });

  test("couper pose une ellipse et écrase les espaces multiples", () => {
    expect(couper("un   texte   long", 8)).toBe("un text…");
    expect(couper("court", 40)).toBe("court");
    expect(couper("peu importe", 0)).toBe("");
  });

  test("echapperMarkdown neutralise ce qui casserait l'embed", () => {
    expect(echapperMarkdown("**gras** _italique_")).toBe("\\*\\*gras\\*\\* \\_italique\\_");
    expect(echapperMarkdown("a|b")).toBe("a\\|b");
    expect(echapperMarkdown("> citation")).toBe("\\> citation");
  });

  test("echapperMarkdown neutralise les crochets, qui casseraient un lien masqué", () => {
    // `**[libellé](url)**` : un `]` non échappé dans le libellé ferme le lien
    // trop tôt et déverse l'URL brute dans l'embed.
    expect(echapperMarkdown("Sondage [rediffusion] ?")).toBe("Sondage \\[rediffusion\\] ?");
    const ligne = ligneListeSondage(
      { ...normaliserSondage(LIGNE_OFFICIELLE, ORIGINE), question: "Titre] cassé" },
      ORIGINE,
    );
    expect(ligne).toContain("Titre\\] cassé");
    expect(ligne.indexOf("](")).toBe(ligne.lastIndexOf("]("));
  });

  test("echapperMarkdown laisse INTACT un émoji personnalisé", () => {
    // Cas réel : la question de `a15eba3c` contient ce jeton. Échapper son
    // souligné casserait le rendu et Discord afficherait l'identifiant.
    expect(echapperMarkdown("cette émote <:IE_hey1:1089276504657117205> ?")).toBe(
      "cette émote <:IE_hey1:1089276504657117205> ?",
    );
    expect(echapperMarkdown("<a:anim_e:12> et _texte_")).toBe("<a:anim_e:12> et \\_texte\\_");
    // Ce qui entoure le jeton reste bien échappé, des deux côtés.
    expect(echapperMarkdown("_a_ <:x_y:1> _b_")).toBe("\\_a\\_ <:x_y:1> \\_b\\_");
  });

  test("texteTitre ramène un émoji personnalisé à son nom", () => {
    // Un titre d'embed ne rend ni markdown ni émoji : le jeton brut y
    // afficherait son identifiant à 19 chiffres.
    expect(texteTitre("incarner cette émote <:IE_hey1:1089276504657117205> ?")).toBe(
      "incarner cette émote :IE_hey1: ?",
    );
    expect(texteTitre("rien à changer")).toBe("rien à changer");
  });

  test("horodatageDate rend un horodatage Discord", () => {
    expect(horodatageDate("2026-08-13T04:22:11.000Z")).toBe("<t:1786594931:D>");
    expect(horodatageDate(null)).toBe("—");
  });
});

describe("visuels republiables", () => {
  test("une pièce jointe Discord est refusée, signée ou non", () => {
    expect(estUrlDiscordSignee("https://cdn.discordapp.com/attachments/1/2/x.png?ex=abc&is=def&hm=123")).toBe(true);
    expect(estUrlDiscordSignee("https://media.discordapp.net/attachments/1/2/x.png")).toBe(true);
    expect(estUrlDiscordSignee("https://rosegriffon.fr/storage/v1/object/public/assets/a.png")).toBe(false);
    expect(estUrlDiscordSignee("pas une url")).toBe(false);
  });

  test("urlAsset construit l'URL publique du seau assets", () => {
    expect(urlAsset("discord/sondages/3e501896/153.png", ORIGINE)).toBe(
      `${ORIGINE}${CHEMIN_ASSETS}discord/sondages/3e501896/153.png`,
    );
    // Les barres de tête et l'origine avec slash final ne doivent pas doubler.
    expect(urlAsset("/a/b.png", "https://rosegriffon.fr/")).toBe(`${ORIGINE}${CHEMIN_ASSETS}a/b.png`);
  });

  test("urlAsset refuse une valeur qui est déjà une URL absolue", () => {
    // Le seul moyen qu'un `://` arrive ici serait une régression de la
    // récolte : mieux vaut pas d'image qu'un lien signé republié.
    expect(urlAsset("https://cdn.discordapp.com/attachments/1/2/x.png", ORIGINE)).toBeNull();
    expect(urlAsset("", ORIGINE)).toBeNull();
    expect(urlAsset(null, ORIGINE)).toBeNull();
  });

  test("urlImageRepubliable ne garde que du https non-Discord", () => {
    expect(urlImageRepubliable("https://pbs.twimg.com/media/HPi5FitWcAEaCB5.jpg")).toBe(
      "https://pbs.twimg.com/media/HPi5FitWcAEaCB5.jpg",
    );
    expect(urlImageRepubliable("http://exemple.fr/a.png")).toBeNull();
    expect(urlImageRepubliable("https://cdn.discordapp.com/a.png?ex=1")).toBeNull();
    expect(urlImageRepubliable(42)).toBeNull();
  });

  test("imagePost préfère notre copie de stockage à pbs.twimg.com", () => {
    const media = [
      {
        original_url: "https://pbs.twimg.com/media/A.jpg",
        storage_url: "https://rosegriffon.fr/storage/v1/object/public/tweets/A.jpg",
        type: "photo",
        url: "https://pbs.twimg.com/media/A.jpg",
      },
    ];
    expect(imagePost(media)).toBe("https://rosegriffon.fr/storage/v1/object/public/tweets/A.jpg");
  });

  test("imagePost retombe sur pbs.twimg.com et ignore le non-photo", () => {
    // Forme réelle de `tweets.media` pour un post de la campagne (13/8/2026).
    const media = [
      {
        height: 720,
        id: "2087621932153729025",
        original_url: "https://pbs.twimg.com/media/HPi5FitWcAEaCB5.jpg",
        preview_url: "https://pbs.twimg.com/media/HPi5FitWcAEaCB5.jpg",
        type: "photo",
        url: "https://pbs.twimg.com/media/HPi5FitWcAEaCB5.jpg",
        width: 1280,
      },
    ];
    expect(imagePost(media)).toBe("https://pbs.twimg.com/media/HPi5FitWcAEaCB5.jpg");
    expect(imagePost([{ type: "video", url: "https://video.twimg.com/x.mp4" }])).toBeNull();
    expect(imagePost(null)).toBeNull();
    expect(imagePost([{ type: "photo", url: "https://cdn.discordapp.com/a.png" }])).toBeNull();
  });
});

describe("sondage — normalisation", () => {
  test("une ligne complète devient un sondage rendable", () => {
    const sondage = normaliserSondage(LIGNE_OFFICIELLE, ORIGINE);
    expect(sondage.pollId).toBe("3e501896");
    expect(sondage.provider).toBe("easypoll");
    expect(sondage.source).toBe("embed");
    expect(sondage.totalVotes).toBe(120);
    expect(sondage.totalVoters).toBe(67);
    expect(sondage.maxChoices).toBe(3);
    expect(sondage.options).toHaveLength(4);
    expect(sondage.visuel?.url).toBe(`${ORIGINE}${CHEMIN_ASSETS}discord/sondages/3e501896/1532068756304433293.png`);
    expect(sondage.visuel?.largeur).toBe(1920);
  });

  test("les choix sont remis dans l'ordre de position", () => {
    const sondage = normaliserSondage(
      {
        ...LIGNE_OFFICIELLE,
        options: [
          { emoji: null, label: "B", percentage: null, position: 1, votes: 1 },
          { emoji: null, label: "A", percentage: null, position: 0, votes: 2 },
        ],
      },
      ORIGINE,
    );
    expect(sondage.options.map(option => option.label)).toEqual(["A", "B"]);
  });

  test("une source inconnue retombe sur embed, un fournisseur inconnu sur easypoll", () => {
    const sondage = normaliserSondage(
      { ...LIGNE_OFFICIELLE, provider: "n'importe quoi", source: "n'importe quoi" },
      ORIGINE,
    );
    expect(sondage.source).toBe("embed");
    expect(sondage.provider).toBe("easypoll");
  });

  test("sans chemin de visuel, aucun visuel n'est fabriqué", () => {
    expect(normaliserSondage(LIGNE_ESTIMEE, ORIGINE).visuel).toBeNull();
  });

  test("des choix absents ou mal formés ne font pas tomber la normalisation", () => {
    expect(normaliserSondage({ ...LIGNE_OFFICIELLE, options: null }, ORIGINE).options).toEqual([]);
    expect(normaliserSondage({ ...LIGNE_OFFICIELLE, options: [null, 3, "x"] }, ORIGINE).options).toEqual([]);
  });
});

describe("sondage — état", () => {
  test("terminé quand l'encart a publié sa clôture", () => {
    const sondage = normaliserSondage(LIGNE_OFFICIELLE, ORIGINE);
    expect(etatSondage(sondage)).toBe("termine");
    expect(libelleEtat(sondage)).toContain("Terminé");
  });

  test("état INCONNU, pas « en cours », quand aucune date de fin n'a été publiée", () => {
    // Marqueur exact des 25 sondages reconstitués : `ended = false` ET
    // `ends_at IS NULL`. Les annoncer « en cours » en 2026 serait faux.
    const sondage = normaliserSondage(LIGNE_ESTIMEE, ORIGINE);
    expect(etatSondage(sondage)).toBe("inconnu");
    expect(libelleEtat(sondage)).toContain("État non publié");
  });

  test("en cours quand une date de fin existe et que la clôture n'est pas publiée", () => {
    const sondage = normaliserSondage(
      { ...LIGNE_OFFICIELLE, ended: false, ends_at: "2026-09-01T00:00:00.000Z" },
      ORIGINE,
    );
    expect(etatSondage(sondage)).toBe("en-cours");
    expect(libelleEtat(sondage)).toContain("En cours");
  });
});

describe("sondage — résultats", () => {
  const officiel = normaliserSondage(LIGNE_OFFICIELLE, ORIGINE);

  test("aDesResultats distingue un sondage chiffré d'un sondage muet", () => {
    expect(aDesResultats(officiel)).toBe(true);
    expect(
      aDesResultats({
        options: officiel.options.map(option => ({ ...option, votes: null })),
        totalVotes: null,
      }),
    ).toBe(false);
  });

  test("le pourcentage est recalculé sur le total des VOTES, pas des participants", () => {
    // 31 / 120 = 25,83 % — et surtout pas 31 / 67 = 46 %, qui dépasserait 100
    // une fois toutes les barres cumulées sur un sondage à trois choix.
    const premier = officiel.options[1] as OptionSondage;
    expect(pourcentage(premier, officiel)).toBeCloseTo(25.83, 2);
  });

  test("pourcentage vaut 0 quand le décompte manque", () => {
    expect(pourcentage({ emoji: null, label: "x", percentage: null, position: 0, votes: null }, officiel)).toBe(0);
    expect(pourcentage(officiel.options[0] as OptionSondage, { totalVotes: 0 })).toBe(0);
  });

  test("classement trie par voix, ex æquo départagés par position", () => {
    expect(classement(officiel).map(option => option.label)).toEqual([
      "Shinohara Raika",
      "Goldie Lemmon / Nanobana Kinako",
      "Fei Rune",
      "Tori Vanguard / Zaizen Touko",
    ]);
  });

  test("gagnant ne couronne pas un ex æquo", () => {
    expect(gagnant(officiel)?.label).toBe("Shinohara Raika");
    const exaequo = {
      options: [
        { emoji: null, label: "A", percentage: null, position: 0, votes: 10 },
        { emoji: null, label: "B", percentage: null, position: 1, votes: 10 },
      ],
      totalVotes: 20,
    };
    expect(gagnant(exaequo)).toBeNull();
  });

  test("gagnant est nul sans résultats ou avec un choix unique", () => {
    expect(
      gagnant({
        options: [{ emoji: null, label: "A", percentage: null, position: 0, votes: 5 }],
        totalVotes: 5,
      }),
    ).toBeNull();
  });
});

describe("sondage — barres", () => {
  test("la barre est proportionnelle et de largeur fixe", () => {
    expect(barre(50, 12)).toBe("██████░░░░░░");
    expect(barre(100, 12)).toBe("████████████");
    expect(barre(0, 12)).toBe("░░░░░░░░░░░░");
    expect(barre(50, 12)).toHaveLength(12);
  });

  test("un pourcentage strictement positif rend au moins un bloc plein", () => {
    // 1 vote sur 500 ne doit pas dessiner une barre vide, qui se lirait « zéro ».
    expect(barre(0.2, 12).startsWith("█")).toBe(true);
  });

  test("seul 100 % remplit toute la barre", () => {
    expect(barre(99.9, 12)).toBe("███████████░");
    expect(barre(-5, 6)).toBe("░░░░░░");
    expect(barre(50, 0)).toHaveLength(1);
  });

  test("formaterPourcentage tient une décimale, virgule française", () => {
    expect(normaliserEspaces(formaterPourcentage(25.83))).toBe("25,8 %");
    expect(normaliserEspaces(formaterPourcentage(0))).toBe("0 %");
    expect(normaliserEspaces(formaterPourcentage(Number.NaN))).toBe("0 %");
  });

  test("ligneResultat compose emoji, barre, pourcentage et voix", () => {
    const officiel = normaliserSondage(LIGNE_OFFICIELLE, ORIGINE);
    const ligne = normaliserEspaces(ligneResultat(officiel.options[1] as OptionSondage, officiel));
    expect(ligne).toContain("🌸 Shinohara Raika");
    expect(ligne).toContain("25,8 %");
    expect(ligne).toContain("31 voix");
    expect(ligne).toContain("█");
  });

  test("ligneResultat annonce l'absence de décompte au lieu d'une barre à zéro", () => {
    const muet = {
      options: [{ emoji: null, label: "A", percentage: null, position: 0, votes: null }],
      totalVotes: null,
    };
    const ligne = ligneResultat(muet.options[0] as OptionSondage, muet);
    expect(ligne).toContain("décompte non publié");
    expect(ligne).not.toContain("█");
  });
});

describe("sondage — estimation vs résultat officiel", () => {
  const officiel = normaliserSondage(LIGNE_OFFICIELLE, ORIGINE);
  const estime = normaliserSondage(LIGNE_ESTIMEE, ORIGINE);

  test("source = reactions ⇒ estimation", () => {
    expect(estEstimation(estime)).toBe(true);
    expect(estEstimation(officiel)).toBe(false);
  });

  test("la mention dit explicitement que ce n'est PAS un résultat officiel", () => {
    const mention = mentionSource(estime);
    expect(mention).not.toBeNull();
    expect(mention).toContain("Estimation");
    expect(mention).toContain("pas un résultat officiel");
    expect(mention).toContain("réactions archivées");
  });

  test("un décompte officiel non masqué ne porte aucune mention", () => {
    expect(mentionSource(officiel)).toBeNull();
  });

  test("des résultats masqués sont annoncés comme tels, sans parler d'estimation", () => {
    const mention = mentionSource({ resultsHidden: true, source: "embed" });
    expect(mention).toContain("masqués");
    expect(mention).not.toContain("Estimation");
  });

  test("le marqueur de liste ne s'affiche que sur une estimation", () => {
    expect(marqueurSource(estime)).toBe("≈");
    expect(marqueurSource(officiel)).toBe("");
  });
});

describe("sondage — libellés", () => {
  test("la participation ne cite les participants que s'ils sont connus", () => {
    const officiel = normaliserSondage(LIGNE_OFFICIELLE, ORIGINE);
    expect(normaliserEspaces(libelleParticipation(officiel) ?? "")).toBe("120 votes de 67 participants");
    // Décompte reconstitué : le nombre de participants n'existe pas, on ne
    // l'invente pas.
    const estime = normaliserSondage(LIGNE_ESTIMEE, ORIGINE);
    expect(normaliserEspaces(libelleParticipation(estime) ?? "")).toBe("192 votes");
    expect(libelleParticipation({ totalVoters: null, totalVotes: null })).toBeNull();
  });

  test("la règle de vote suit max_choices, 0 valant illimité", () => {
    expect(libelleChoixAutorises({ maxChoices: 3 })).toBe("3 choix par personne");
    expect(libelleChoixAutorises({ maxChoices: 1 })).toBe("1 choix par personne");
    expect(libelleChoixAutorises({ maxChoices: 0 })).toBe("Choix illimités");
  });

  test("le lien du message d'origine n'existe que si le message est connu", () => {
    const officiel = normaliserSondage(LIGNE_OFFICIELLE, ORIGINE);
    expect(lienMessageSondage(officiel)).toBe(
      "https://discord.com/channels/1136706801912516608/1136706802579411025/1532068756304433290",
    );
    expect(lienMessageSondage(normaliserSondage(LIGNE_ESTIMEE, ORIGINE))).toBeNull();
  });

  test("la ligne de liste porte question, lien, état et tête de course", () => {
    const ligne = normaliserEspaces(ligneListeSondage(normaliserSondage(LIGNE_OFFICIELLE, ORIGINE), ORIGINE));
    expect(ligne).toContain("https://rosegriffon.fr/sondages/3e501896");
    expect(ligne).toContain("Terminé");
    expect(ligne).toContain("120 votes de 67 participants");
    expect(ligne).toContain("Shinohara Raika");
  });

  test("la ligne de liste d'une estimation porte le marqueur ≈", () => {
    expect(ligneListeSondage(normaliserSondage(LIGNE_ESTIMEE, ORIGINE), ORIGINE)).toContain("≈");
  });

  test("un identifiant de sondage est hexadécimal court ou un identifiant Discord", () => {
    expect(estIdentifiantSondage("3e501896")).toBe(true);
    expect(estIdentifiantSondage("1532068756304433290")).toBe(true);
    expect(estIdentifiantSondage("'; DROP TABLE")).toBe(false);
    expect(estIdentifiantSondage("ZZZZZZ")).toBe(false);
  });
});

describe("sondage — filtres de liste", () => {
  test("un statut hors liste blanche retombe sur « tous »", () => {
    expect(normaliserStatut("en-cours")).toBe("en-cours");
    expect(normaliserStatut("etat-inconnu")).toBe("etat-inconnu");
    expect(normaliserStatut("n'importe quoi")).toBe("tous");
    expect(normaliserStatut(undefined)).toBe("tous");
  });

  test("chaque statut a un libellé français", () => {
    expect(libelleStatut("termines")).toBe("terminés");
    expect(libelleStatut("etat-inconnu")).toBe("état non publié");
    expect(libelleStatut("tous")).toBe("tous");
  });

  test("une période relative se résout en borne basse seule", () => {
    const maintenant = new Date("2026-08-13T12:00:00.000Z");
    const periode = normaliserPeriode("30-jours", maintenant);
    expect(periode.cle).toBe("30-jours");
    expect(periode.jusqua).toBeNull();
    expect(periode.depuis?.toISOString()).toBe("2026-07-14T12:00:00.000Z");
  });

  test("une année se résout en bornes UTC, haute EXCLUE", () => {
    // En bornant sur le fuseau local, un sondage du 31 décembre changerait
    // d'année selon la machine qui exécute le bot.
    const periode = normaliserPeriode("2024");
    expect(periode.depuis?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(periode.jusqua?.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(periode.libelle).toBe("année 2024");
  });

  test("une période inconnue rend « toutes périodes » plutôt qu'une liste vide", () => {
    for (const valeur of ["", "n'importe quoi", "1800", "3200", undefined, 2024]) {
      const periode = normaliserPeriode(valeur);
      expect(periode.cle).toBe("tout");
      expect(periode.depuis).toBeNull();
      expect(periode.jusqua).toBeNull();
    }
  });
});

describe("campagne", () => {
  const campagne = normaliserCampagne(LIGNE_CAMPAGNE);

  test("une ligne devient une campagne rendable", () => {
    expect(campagne.slug).toBe("inazuma-day-2026");
    expect(campagne.actif).toBe(true);
    expect(campagne.hashtags).toHaveLength(2);
    expect(campagne.debutLe?.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  test("une image de campagne absolue et republiable est gardée", () => {
    const avecImage = normaliserCampagne({
      ...LIGNE_CAMPAGNE,
      image_couverture: `${ORIGINE}${CHEMIN_ASSETS}campagnes/iergday/couverture.webp`,
    });
    expect(avecImage.imageCouverture).toBe(`${ORIGINE}${CHEMIN_ASSETS}campagnes/iergday/couverture.webp`);
  });

  test("une image de campagne pointant sur Discord est écartée", () => {
    const piegee = normaliserCampagne({
      ...LIGNE_CAMPAGNE,
      image_affiche: "https://cdn.discordapp.com/attachments/1/2/affiche.png?ex=1&is=2&hm=3",
    });
    expect(piegee.imageAffiche).toBeNull();
  });

  test("les hashtags reprennent la casse d'affichage, et retombent sinon", () => {
    // `hashtags_affichage` ne couvre que le premier : le second reste dans sa
    // forme normalisée, ce qui reste exact.
    expect(hashtagsAffichables(campagne)).toEqual(["#InazumaDay", "#8月22日はイナイレの日"]);
  });

  test("l'état vient des dates, pas du drapeau de récolte", () => {
    expect(etatCampagne(campagne, new Date("2026-08-13T00:00:00.000Z"))).toBe("en-cours");
    expect(etatCampagne(campagne, new Date("2026-09-05T00:00:00.000Z"))).toBe("terminee");
    expect(etatCampagne(campagne, new Date("2026-08-01T00:00:00.000Z"))).toBe("a-venir");
    expect(etatCampagne({ debutLe: null, finLe: null })).toBe("indetermine");
    expect(libelleEtatCampagne(campagne, new Date("2026-08-13T00:00:00.000Z"))).toContain("En cours");
    expect(libelleEtatCampagne({ debutLe: null, finLe: null })).toContain("Période non publiée");
  });

  test("la période se dit avec ce qui est connu", () => {
    expect(periodeCampagne(campagne)).toContain("du <t:");
    expect(periodeCampagne({ debutLe: null, finLe: new Date("2026-08-22T21:59:59.000Z") })).toContain("jusqu'au");
    expect(periodeCampagne({ debutLe: new Date("2023-08-01T22:00:00.000Z"), finLe: null })).toContain("depuis le");
    expect(periodeCampagne({ debutLe: null, finLe: null })).toBeNull();
  });

  test("le chemin du site distingue la campagne à la une", () => {
    expect(cheminCampagne({ principale: true, slug: "iergday" })).toBe("/iergday");
    expect(cheminCampagne({ principale: false, slug: "inazuma-day-2026" })).toBe("/iergday?campagne=inazuma-day-2026");
  });

  test("un slug de campagne ne peut être qu'un slug", () => {
    expect(estSlugCampagne("inazuma-day-2026")).toBe(true);
    expect(estSlugCampagne("iergday")).toBe(true);
    expect(estSlugCampagne("Inazuma Day")).toBe(false);
    expect(estSlugCampagne("' OR 1=1--")).toBe(false);
  });
});

describe("campagne — agrégats", () => {
  /** Chiffres RÉELS de `inazuma-day-2026`, mesurés le 13/8/2026. */
  const stats: StatsCampagne = {
    auteurs: 363,
    creations: 0,
    derniere: new Date("2026-08-13T04:22:11.000Z"),
    jaime: 14_098,
    posts: 464,
    repartages: 1839,
    vues: 321_263,
  };

  test("la ligne de métriques reprend les trois compteurs publics", () => {
    const ligne = normaliserEspaces(ligneMetriques(stats));
    expect(ligne).toContain("14 098");
    expect(ligne).toContain("1 839");
    expect(ligne).toContain("321 263");
  });

  test("la ligne de participations accorde et dit l'absence de créations", () => {
    const ligne = normaliserEspaces(ligneParticipations(stats));
    expect(ligne).toContain("464 publications X");
    expect(ligne).toContain("363 comptes");
    expect(ligne).toContain("aucune création Discord republiable");
  });

  test("des créations récoltées sont comptées au lieu du message d'absence", () => {
    const ligne = normaliserEspaces(ligneParticipations({ ...stats, creations: 12 }));
    expect(ligne).toContain("12 créations Discord");
    expect(ligne).not.toContain("aucune création");
  });

  test("la ligne de liste porte le lien, l'état et le volume", () => {
    const ligne = normaliserEspaces(
      ligneListeCampagne(normaliserCampagne(LIGNE_CAMPAGNE), stats, ORIGINE, new Date("2026-08-13T00:00:00.000Z")),
    );
    expect(ligne).toContain("https://rosegriffon.fr/iergday?campagne=inazuma-day-2026");
    expect(ligne).toContain("En cours");
    expect(ligne).toContain("464 publications");
    expect(ligne).toContain("#InazumaDay");
  });

  test("une campagne sans rien à montrer explique pourquoi", () => {
    // `iergday` : 0 publication X, 0 création republiable, récolte du jour.
    const note = noteCampagneVide(
      { collecteLe: new Date("2026-08-13T05:20:07.771Z"), salonsDepot: ["1153955426191278132"] },
      { creations: 0, posts: 0 },
    );
    expect(note).toContain("Rien n'a encore été récolté");
    expect(note).toContain("<#1153955426191278132>");
    expect(note).toContain("Dernière passe de récolte <t:");
  });

  test("aucune note quand la campagne a de quoi montrer", () => {
    expect(noteCampagneVide({ collecteLe: null, salonsDepot: [] }, stats)).toBeNull();
    expect(noteCampagneVide({ collecteLe: null, salonsDepot: [] }, { creations: 3, posts: 0 })).toBeNull();
  });

  test("le lien d'un post reste valable même sans auteur connu", () => {
    expect(lienPost({ auteur: "ryochan_642", tweetId: "2087637747909669293" })).toBe(
      "https://x.com/ryochan_642/status/2087637747909669293",
    );
    expect(lienPost({ auteur: null, tweetId: "2087637747909669293" })).toBe(
      "https://x.com/i/status/2087637747909669293",
    );
  });
});

describe("pagination", () => {
  test("le nombre de pages ne descend jamais sous 1", () => {
    expect(nombreDePages(51, 5)).toBe(11);
    expect(nombreDePages(0, 5)).toBe(1);
    expect(nombreDePages(5, 5)).toBe(1);
  });

  test("une page hors bornes est ramenée dans les bornes", () => {
    expect(bornerPage(99, 51, 5)).toBe(11);
    expect(bornerPage(0, 51, 5)).toBe(1);
    expect(bornerPage(-3, 51, 5)).toBe(1);
    expect(bornerPage(Number.NaN, 51, 5)).toBe(1);
    expect(bornerPage(3, 51, 5)).toBe(3);
  });

  test("l'état d'une liste de sondages fait l'aller-retour par le customId", () => {
    const etat = { page: 4, periode: "2024", recherche: "émote", statut: "termines" as const };
    const id = encoderEtatSondages(etat);
    expect(id).not.toBeNull();
    expect((id as string).length).toBeLessThanOrEqual(MAX_CUSTOM_ID);
    expect(decoderEtatSondages(id as string)).toEqual(etat);
  });

  test("une recherche contenant le séparateur ne casse pas le décodage", () => {
    const id = encoderEtatSondages({
      page: 1,
      periode: "tout",
      recherche: "a|b|c",
      statut: "tous",
    });
    expect(decoderEtatSondages(id as string)?.recherche).toBe("a b c");
  });

  test("un état trop long ne produit pas de customId (les boutons sont alors omis)", () => {
    expect(
      encoderEtatSondages({
        page: 1,
        periode: "tout",
        recherche: "x".repeat(200),
        statut: "tous",
      }),
    ).toBeNull();
  });

  test("un customId étranger ou abîmé est refusé", () => {
    expect(decoderEtatSondages("tw|1|a|b|c")).toBeNull();
    expect(decoderEtatSondages("sdg|zéro|tous|tout|")).toBeNull();
    expect(decoderEtatSondages("sdg|1|tous")).toBeNull();
    expect(decoderEtatSondages("")).toBeNull();
  });

  test("l'état d'une liste de campagnes fait l'aller-retour", () => {
    const id = encoderEtatCampagnes({ enCours: true, page: 2 });
    expect(decoderEtatCampagnes(id as string)).toEqual({ enCours: true, page: 2 });
    expect(decoderEtatCampagnes(encoderEtatCampagnes({ enCours: false, page: 1 }) as string)).toEqual({
      enCours: false,
      page: 1,
    });
  });

  test("les deux familles de boutons ne se confondent pas", () => {
    const idSondages = encoderEtatSondages({
      page: 1,
      periode: "tout",
      recherche: null,
      statut: "tous",
    }) as string;
    expect(decoderEtatCampagnes(idSondages)).toBeNull();
    const idCampagnes = encoderEtatCampagnes({ enCours: false, page: 1 }) as string;
    expect(decoderEtatSondages(idCampagnes)).toBeNull();
  });
});

describe("vie privée — non-dérive", () => {
  /*
   * Le nom de la table des votes NOMINATIFS n'est jamais écrit en clair, pas
   * même ici : il est reconstruit à l'exécution. Le test échoue si l'un des
   * trois fichiers de cette unité le contient — en SQL, en identifiant ou en
   * commentaire.
   */
  const RACINE = fileURLToPath(new URL("../..", import.meta.url));
  // Les quatre fichiers de l'unité sondage, pas seulement ceux qui touchent la base.
  const FICHIERS = [
    "src/lib/sondage-format.ts",
    "src/lib/sondage-format.test.ts",
    "src/commands/sondage.ts",
    "src/commands/campagne.ts",
  ];
  const INTERDIT = ["discord", "poll", "votes"].join("_");

  test("aucun fichier de l'unité ne nomme la table des votes nominatifs", async () => {
    for (const chemin of FICHIERS) {
      const contenu = await Bun.file(join(RACINE, chemin)).text();
      expect(contenu.toLowerCase()).not.toContain(INTERDIT);
    }
  });

  test("aucun fichier de l'unité ne lit une colonne d'identité de votant", async () => {
    // Les seules colonnes de vote lues sont des DÉCOMPTES agrégés.
    const suspects = [
      ["voter", "id"].join("_"),
      ["user", "id"].join("_") + " ", // `user_id` isolé, pas `guild_id`
    ];
    for (const chemin of FICHIERS) {
      const contenu = (await Bun.file(join(RACINE, chemin)).text()).toLowerCase();
      for (const suspect of suspects) {
        expect(contenu).not.toContain(suspect);
      }
    }
  });
});
