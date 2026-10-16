/**
 * Calibrage du rapprochement de comptes.
 *
 * Ce que ces tests protègent n'est pas le calcul — c'est le CALIBRAGE. Un
 * module qui rapproche des comptes se juge sur deux erreurs symétriques, et
 * elles n'ont pas le même coût : manquer un double compte laisse passer un
 * contournement de sanction, mais désigner à tort deux membres qui n'ont rien
 * en commun met le staff en position d'accuser quelqu'un sur la foi d'une
 * coïncidence. Les cas ci-dessous fixent donc surtout la seconde borne : ce qui
 * ne DOIT PAS franchir le seuil.
 *
 * Les données sont calquées sur la production relevée le 29/8/2026 (avatars par
 * défaut partagés par 25 comptes, image populaire partagée par 8).
 */
import { describe, expect, test } from "bun:test";

import {
  balayer,
  clePaire,
  comparer,
  dateDeCreation,
  distance,
  ecartLisible,
  empreinteAvatar,
  EPOQUE_DISCORD,
  libelleBalayage,
  niveauDeScore,
  normaliserPseudo,
  poidsDegressif,
  racinePseudo,
  similarite,
  type EmpreinteCompte,
} from "./multicomptes";

// ─── Fabrique ───────────────────────────────────────────────────────────────

const JOUR = 86_400_000;

/** Flocon Discord fabriqué pour une date donnée — l'inverse de `dateDeCreation`. */
function flocon(creeLe: Date): string {
  return String((BigInt(creeLe.getTime() - EPOQUE_DISCORD) << 22n) | 1n);
}

function compte(partiel: Partial<EmpreinteCompte> & { pseudo: string }): EmpreinteCompte {
  const creeLe = partiel.discordId
    ? (dateDeCreation(partiel.discordId) ?? new Date("2024-01-01T00:00:00Z"))
    : new Date("2024-01-01T00:00:00Z");
  return {
    arriveeLe: null,
    avatar: null,
    discordId: partiel.discordId ?? flocon(creeLe),
    liaisons: [],
    messages: 0,
    nomAffiche: null,
    partiLe: null,
    roles: [],
    surnom: null,
    ...partiel,
  };
}

function avatar(condensat: string): string {
  return `https://cdn.discordapp.com/avatars/1234567890123456/${condensat}.webp?size=256`;
}

/**
 * Pseudo sans aucun voisin : deux lettres qui varient AVEC l'indice, donc des
 * préfixes tous différents. Un générateur naïf (`membre${index}`) fabriquerait
 * au contraire une famille de pseudos qui se ressemblent tous — le module les
 * rapprocherait, à juste titre, et le test mesurerait son propre jeu de données.
 */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
function pseudoDistinct(index: number): string {
  return `${ALPHABET[index % 26]}${ALPHABET[Math.floor(index / 26) % 26]}zqvkmn`;
}

const IMAGE_A = "c82b3fa769ed6e6ffdea579381ed5f5c";
const IMAGE_B = "157e517cdbf371a47aaead44675714a3";

// ─── Flocons ────────────────────────────────────────────────────────────────

describe("dateDeCreation", () => {
  test("lit la date encodée dans un flocon réel", () => {
    // Le flocon d'exemple de la documentation Discord, dont la date est publiée
    // avec lui. Aucun identifiant du serveur n'est écrit ici : `profil.test.ts`
    // interdit d'en semer ailleurs que dans le registre.
    expect(dateDeCreation("175928847299117063")?.toISOString()).toBe("2016-04-30T11:18:25.796Z");
  });

  test("refuse ce qui n'est pas un flocon", () => {
    for (const valeur of ["", "abc", "12", null, undefined, "12345678901234567890123456"]) {
      expect(dateDeCreation(valeur)).toBeNull();
    }
  });

  test("fait l'aller-retour avec la fabrique de test", () => {
    const le = new Date("2026-03-14T10:00:00.000Z");
    expect(dateDeCreation(flocon(le))?.getTime()).toBe(le.getTime());
  });
});

// ─── Normalisation ──────────────────────────────────────────────────────────

describe("normaliserPseudo", () => {
  test("écrase accents, casse et ponctuation", () => {
    expect(normaliserPseudo("Éliàs_Mark")).toBe("eliasmark");
  });

  test("rétablit les chiffres-lettres", () => {
    expect(normaliserPseudo("m4rk_3v4n5")).toBe("markevans");
  });

  test("ramène les alphabets décoratifs à l'ASCII", () => {
    // Un pseudo en pleine largeur est illisible pour une comparaison naïve —
    // et c'est souvent le but.
    expect(normaliserPseudo("Ｍａｒｋ")).toBe("mark");
  });

  test("rend une chaîne vide pour ce qui n'a aucune lettre latine", () => {
    expect(normaliserPseudo("キズナ")).toBe("");
    expect(normaliserPseudo(null)).toBe("");
  });
});

describe("racinePseudo", () => {
  test("retire chiffres et suffixes de double compte", () => {
    expect(racinePseudo("markevans")).toBe("markevans");
    expect(racinePseudo("MarkEvans_alt2")).toBe("markevans");
    expect(racinePseudo("markevans_bis")).toBe("markevans");
    expect(racinePseudo("mark_evans_officiel")).toBe("markevans");
  });

  test("réduit les lettres étirées", () => {
    expect(racinePseudo("m4rrrrk3vans")).toBe("markevans");
  });

  test("retire les chiffres de queue AVANT de les plier en lettres", () => {
    // Le piège : `normaliserPseudo` plie 0,1,3,4,5,7,8 en lettres. Si le retrait
    // des chiffres de queue passe APRÈS, il ne trouve plus de chiffre —
    // `christo931` vaut déjà `christo9ei`. Mesuré sur la production du
    // 29/8/2026 : 94 % des pseudos à suffixe numérique gardaient leur suffixe,
    // et l'indice `racine` ne se déclenchait que 4 fois sur 1 338
    // rapprochements au lieu de 23.
    //
    // `MarkEvans_alt2` seul ne voit RIEN : 2 est le seul chiffre absent de la
    // table « leet ». Il faut des cas avec 3, 0, 1, 5…
    expect(racinePseudo("christo931")).toBe(racinePseudo("christo"));
    expect(racinePseudo("markevans3")).toBe(racinePseudo("markevans10"));
    expect(racinePseudo("rudy5859")).toBe("rudy");
    expect(racinePseudo("theo07142")).toBe(racinePseudo("theo0005"));
    expect(racinePseudo("shadow12_70")).toBe(racinePseudo("shadow234314"));
  });

  test("refuse une racine trop courte pour discriminer", () => {
    // « xx » rapprocherait la moitié du serveur.
    expect(racinePseudo("xx")).toBe("");
    expect(racinePseudo("aaaa")).toBe("");
    expect(racinePseudo("2024")).toBe("");
  });

  test("ne mange pas un suffixe quand il ne reste rien derrière", () => {
    // `off` est bien un suffixe de double compte, mais `boff` n'est pas le
    // compte « b » de quelqu'un : la garde de longueur l'empêche.
    expect(racinePseudo("markoff")).toBe("mark");
    expect(racinePseudo("boff")).toBe("bof");
    expect(racinePseudo("off")).toBe("");
  });
});

describe("distance et similarite", () => {
  test("distance de Levenshtein classique", () => {
    expect(distance("mark", "mark")).toBe(0);
    expect(distance("mark", "marc")).toBe(1);
    expect(distance("mark", "")).toBe(4);
  });

  test("le plafond fait abandonner sans mentir sur la proximité", () => {
    // Au-delà du plafond, la valeur exacte n'a pas d'intérêt : seule compte
    // l'information « plus loin que ça ».
    expect(distance("markevans", "azaleewiki", 2)).toBeGreaterThan(2);
  });

  test("similarite borne à zéro ce qui est trop éloigné", () => {
    expect(similarite("markevans", "markevanss")).toBeGreaterThan(0.85);
    expect(similarite("markevans", "gouenjishuya")).toBe(0);
    expect(similarite("", "")).toBe(0);
  });
});

// ─── Avatars ────────────────────────────────────────────────────────────────

describe("empreinteAvatar", () => {
  test("extrait le condensat d'une image téléversée", () => {
    expect(empreinteAvatar(avatar(IMAGE_A))).toBe(IMAGE_A);
  });

  test("accepte les avatars animés", () => {
    expect(empreinteAvatar(avatar(`a_${IMAGE_A}`))).toBe(`a_${IMAGE_A}`);
  });

  test("IGNORE les avatars par défaut", () => {
    // Le cas qui noie tout : 122 membres de la production se répartissent les
    // cinq images par défaut de Discord, dont 25 sur la même.
    for (let index = 0; index < 5; index++) {
      expect(empreinteAvatar(`https://cdn.discordapp.com/embed/avatars/${index}.png`)).toBeNull();
    }
  });

  test("refuse ce qui n'a pas la forme d'un condensat", () => {
    expect(empreinteAvatar("https://exemple.fr/photo.png")).toBeNull();
    expect(empreinteAvatar(null)).toBeNull();
    expect(empreinteAvatar("")).toBeNull();
  });
});

describe("poidsDegressif", () => {
  test("une paire garde tout le poids", () => {
    expect(poidsDegressif(34, 2)).toBe(34);
  });

  test("une image populaire n'en garde presque rien", () => {
    // 8 comptes partagent la même image en production : ce n'est pas un indice,
    // c'est un mème.
    expect(poidsDegressif(34, 8)).toBeLessThan(6);
    expect(poidsDegressif(34, 4)).toBeLessThan(poidsDegressif(34, 3));
  });
});

// ─── Comparaison ────────────────────────────────────────────────────────────

describe("comparer — ce qui NE DOIT PAS rapprocher", () => {
  test("deux inconnus sans rien en commun", () => {
    expect(
      comparer(
        compte({ pseudo: "markevans", discordId: flocon(new Date("2019-04-02T00:00:00Z")) }),
        compte({ pseudo: "gouenji", discordId: flocon(new Date("2024-11-20T00:00:00Z")) }),
      ),
    ).toBeNull();
  });

  test("deux comptes sans avatar (donc avatar par défaut)", () => {
    const a = compte({
      avatar: "https://cdn.discordapp.com/embed/avatars/1.png",
      discordId: flocon(new Date("2018-01-01T00:00:00Z")),
      pseudo: "poimoi23",
    });
    const b = compte({
      avatar: "https://cdn.discordapp.com/embed/avatars/1.png",
      discordId: flocon(new Date("2023-06-06T00:00:00Z")),
      pseudo: "lyoex0609",
    });
    expect(comparer(a, b)).toBeNull();
  });

  test("une image populaire seule ne suffit pas", () => {
    const a = compte({
      avatar: avatar(IMAGE_A),
      discordId: flocon(new Date("2019-01-01T00:00:00Z")),
      pseudo: "elie04801",
    });
    const b = compte({
      avatar: avatar(IMAGE_A),
      discordId: flocon(new Date("2025-01-01T00:00:00Z")),
      pseudo: "kamildetektyw",
    });
    const grappeDeHuit = comparer(a, b, { tailleGrappeAvatar: 8 });
    expect(grappeDeHuit).toBeNull();
  });

  test("un surnom partagé ne suffit pas à faire un faisceau", () => {
    // « Capitaine », « Coach », « Manager » : des surnoms de serveur que
    // plusieurs membres portent sans le moindre rapport. La même constatation
    // était facturée DEUX fois — l'indice `surnom` (24) puis l'indice `pseudo`
    // (18), qui retrouvait forcément ce surnom comme meilleure ressemblance —
    // et atteignait 42, c'est-à-dire pile le seuil de « faisceau d'indices ».
    const rapprochement = comparer(
      compte({
        discordId: flocon(new Date("2019-01-01T00:00:00Z")),
        pseudo: "zorglubxyz",
        surnom: "Capitaine",
      }),
      compte({
        discordId: flocon(new Date("2025-01-01T00:00:00Z")),
        pseudo: "qwertyasdf",
        surnom: "Capitaine",
      }),
    );
    expect(rapprochement?.indices.map(indice => indice.cle)).toEqual(["surnom"]);
    expect(rapprochement?.niveau).toBe("possible");
  });

  test("les seules dates ne dépassent JAMAIS « à examiner »", () => {
    // Deux amis invités le même soir créent leur compte dans la même
    // demi-heure, rejoignent dans la même minute, et sont neufs à l'arrivée.
    // Sans budget commun, cela faisait 42 points — « faisceau d'indices » sur
    // deux personnes qui ont cliqué sur la même invitation. Cas réel :
    // `lord098861 ↔ ksar0075`, 37 points, avatars par défaut différents et
    // pseudos sans rapport.
    const creation = new Date("2024-05-05T20:00:00Z");
    const arrivee = new Date("2024-05-05T20:35:00Z");
    const rapprochement = comparer(
      compte({
        arriveeLe: arrivee,
        discordId: flocon(creation),
        pseudo: "lordzzzqqq",
      }),
      compte({
        arriveeLe: new Date(arrivee.getTime() + 60_000),
        discordId: flocon(new Date(creation.getTime() + 32 * 60_000)),
        pseudo: "ksarwwwvvv",
      }),
    );
    expect(rapprochement?.score).toBeLessThanOrEqual(24);
    expect(rapprochement?.niveau).toBe("possible");
    // `jeune` exige un indice d'IDENTITÉ : « créé la veille de son arrivée »
    // décrit la moitié des nouveaux membres, et l'accoler à « arrivé le même
    // jour » ne dit rien de plus que « deux personnes se sont inscrites en
    // même temps ».
    expect(rapprochement?.indices.map(indice => indice.cle) ?? []).not.toContain("jeune");
  });

  test("une seule journée de création partagée reste une coïncidence", () => {
    // Sept membres actifs ont créé leur compte le 17 mars 2020 : c'est une
    // journée chargée, pas une fratrie.
    const jour = new Date("2020-03-17T12:00:00Z");
    const rapprochement = comparer(
      compte({ discordId: flocon(jour), pseudo: "vaarsaaa" }),
      compte({ discordId: flocon(new Date(jour.getTime() + 4 * 3_600_000)), pseudo: "monroe0111" }),
    );
    expect(rapprochement?.niveau ?? null).not.toBe("fort");
    expect(rapprochement?.niveau ?? null).not.toBe("certain");
  });
});

describe("comparer — ce qui DOIT rapprocher", () => {
  test("un rattachement déclaré vaut certitude, quel que soit le reste", () => {
    const rapprochement = comparer(
      compte({
        discordId: flocon(new Date("2017-01-01T00:00:00Z")),
        liaisons: ["profil:9f1c-…"],
        pseudo: "markevans",
      }),
      compte({
        discordId: flocon(new Date("2026-01-01T00:00:00Z")),
        liaisons: ["profil:9f1c-…"],
        pseudo: "rienavoir",
      }),
    );
    expect(rapprochement?.niveau).toBe("certain");
    expect(rapprochement?.indices[0]?.cle).toBe("liaison");
  });

  test("le détail d'une liaison ne dit JAMAIS sa valeur", () => {
    // Un condensat de courriel dans un embed, c'est une fuite de donnée
    // personnelle dans l'historique d'un salon.
    const rapprochement = comparer(
      compte({ liaisons: ["courriel:5f4dcc3b5aa765d61d8327deb882cf99"], pseudo: "a_pseudo" }),
      compte({
        discordId: flocon(new Date("2025-06-01T00:00:00Z")),
        liaisons: ["courriel:5f4dcc3b5aa765d61d8327deb882cf99"],
        pseudo: "b_pseudo",
      }),
    );
    const detail = rapprochement?.indices.map(indice => indice.detail).join(" ") ?? "";
    expect(detail).toContain("courriel");
    expect(detail).not.toContain("5f4dcc3b");
  });

  test("le faisceau classique : même image rare, pseudo voisin, arrivées collées", () => {
    const arrivee = new Date("2026-02-01T18:00:00Z");
    const rapprochement = comparer(
      compte({
        arriveeLe: arrivee,
        avatar: avatar(IMAGE_B),
        discordId: flocon(new Date("2021-05-05T00:00:00Z")),
        pseudo: "markevans",
      }),
      compte({
        arriveeLe: new Date(arrivee.getTime() + 5 * 60_000),
        avatar: avatar(IMAGE_B),
        discordId: flocon(new Date("2026-01-30T00:00:00Z")),
        pseudo: "markevans_alt2",
      }),
    );
    expect(rapprochement?.niveau).toBe("certain");
    expect(rapprochement?.indices.map(indice => indice.cle)).toContain("racine");
    expect(rapprochement?.indices.map(indice => indice.cle)).toContain("avatar");
  });

  test("la relève : un compte part, un autre arrive dans la foulée", () => {
    const depart = new Date("2026-06-01T10:00:00Z");
    const rapprochement = comparer(
      compte({
        arriveeLe: new Date("2024-01-01T00:00:00Z"),
        discordId: flocon(new Date("2020-01-01T00:00:00Z")),
        partiLe: depart,
        pseudo: "shadow12",
      }),
      compte({
        arriveeLe: new Date(depart.getTime() + 40 * 60_000),
        discordId: flocon(new Date("2026-05-30T00:00:00Z")),
        pseudo: "shadow12_new",
      }),
    );
    const cles = rapprochement?.indices.map(indice => indice.cle) ?? [];
    expect(cles).toContain("releve");
    expect(cles).toContain("jeune");
    expect(rapprochement?.niveau).toBe("fort");
  });

  test("le compte le plus ancien est toujours en A", () => {
    const ancien = compte({
      discordId: flocon(new Date("2018-01-01T00:00:00Z")),
      pseudo: "markevans",
    });
    const recent = compte({
      discordId: flocon(new Date("2026-01-01T00:00:00Z")),
      pseudo: "markevans2",
    });
    expect(comparer(ancien, recent)?.compteA).toBe(ancien.discordId);
    expect(comparer(recent, ancien)?.compteA).toBe(ancien.discordId);
  });
});

describe("comparer — activité", () => {
  const base = (surcharge: Partial<EmpreinteCompte>): EmpreinteCompte => compte({ pseudo: "markevans", ...surcharge });

  const paire = (): [EmpreinteCompte, EmpreinteCompte] => [
    base({ discordId: flocon(new Date("2020-01-01T00:00:00Z")) }),
    base({ discordId: flocon(new Date("2024-01-01T00:00:00Z")), pseudo: "markevans_bis" }),
  ];

  test("l'alternance parfaite pèse", () => {
    const [a, b] = paire();
    const rapprochement = comparer(a, b, {
      activite: { creneauxA: 400, creneauxB: 120, creneauxCommuns: 0, salonsCommuns: 5 },
    });
    expect(rapprochement?.indices.map(indice => indice.cle)).toContain("alternance");
  });

  test("sans activité suffisante, l'absence de recouvrement ne dit RIEN", () => {
    // L'archive ne couvre que les salons suivis et un membre sur huit : sans
    // minimum des deux côtés, « zéro créneau commun » veut dire « zéro donnée ».
    const [a, b] = paire();
    const rapprochement = comparer(a, b, {
      activite: { creneauxA: 400, creneauxB: 3, creneauxCommuns: 0, salonsCommuns: 5 },
    });
    expect(rapprochement?.indices.map(indice => indice.cle) ?? []).not.toContain("alternance");
  });

  test("une activité simultanée retire des points, sans disculper", () => {
    const [a, b] = paire();
    const seul = comparer(a, b)?.score ?? 0;
    const avecSimultaneite =
      comparer(a, b, {
        activite: { creneauxA: 200, creneauxB: 180, creneauxCommuns: 90, salonsCommuns: 4 },
      })?.score ?? 0;
    expect(avecSimultaneite).toBeLessThan(seul);
  });
});

// ─── Balayage ───────────────────────────────────────────────────────────────

describe("balayer", () => {
  test("trouve la paire au milieu du bruit", () => {
    const bruit = Array.from({ length: 60 }, (_, index) =>
      compte({
        avatar: `https://cdn.discordapp.com/embed/avatars/${index % 5}.png`,
        discordId: flocon(new Date(Date.UTC(2020, 0, 1 + index))),
        pseudo: pseudoDistinct(index),
      }),
    );
    const arrivee = new Date("2026-02-01T18:00:00Z");
    const cible = [
      compte({
        arriveeLe: arrivee,
        avatar: avatar(IMAGE_B),
        discordId: flocon(new Date("2021-05-05T00:00:00Z")),
        pseudo: "kazemaru",
      }),
      compte({
        arriveeLe: new Date(arrivee.getTime() + 120_000),
        avatar: avatar(IMAGE_B),
        discordId: flocon(new Date("2026-01-30T00:00:00Z")),
        pseudo: "kazemaru_alt",
      }),
    ];

    const balayage = balayer([...bruit, ...cible]);
    expect(balayage.comptes).toBe(62);
    expect(balayage.rapprochements[0]?.compteA).toBe(cible[0]!.discordId);
    expect(balayage.rapprochements[0]?.compteB).toBe(cible[1]!.discordId);
    // 62 comptes, c'est 1 891 paires possibles : le regroupement doit en
    // écarter la très grande majorité sans les calculer.
    expect(balayage.pairesExaminees).toBeLessThan(200);
  });

  test("une grappe trop large n'engendre aucun candidat", () => {
    // 30 comptes créés le même jour : 435 paires sans le moindre intérêt.
    const meme = new Date("2020-03-17T00:00:00Z");
    const foule = Array.from({ length: 30 }, (_, index) =>
      compte({
        discordId: flocon(new Date(meme.getTime() + index * 60_000)),
        pseudo: pseudoDistinct(index),
      }),
    );
    expect(balayer(foule).rapprochements).toHaveLength(0);
  });

  test("une liaison partagée passe outre la taille de grappe", () => {
    // Un rattachement déclaré n'est pas une coïncidence : il ne se dilue pas.
    const foule = Array.from({ length: 30 }, (_, index) =>
      compte({
        discordId: flocon(new Date(Date.UTC(2020, 0, 1 + index))),
        liaisons: ["profil:commun"],
        pseudo: pseudoDistinct(index),
      }),
    );
    const balayage = balayer(foule, { niveauMinimum: "certain" });
    expect(balayage.rapprochements.length).toBe((30 * 29) / 2);
  });

  test("le filtre de niveau s'applique", () => {
    const arrivee = new Date("2026-02-01T18:00:00Z");
    const population = [
      compte({
        arriveeLe: arrivee,
        discordId: flocon(new Date("2021-05-05T00:00:00Z")),
        pseudo: "endou",
      }),
      compte({
        arriveeLe: new Date(arrivee.getTime() + 20 * 3_600_000),
        discordId: flocon(new Date("2021-05-06T00:00:00Z")),
        pseudo: "endoutv",
      }),
    ];
    expect(balayer(population).rapprochements.length).toBeGreaterThan(0);
    expect(balayer(population, { niveauMinimum: "certain" }).rapprochements).toHaveLength(0);
  });

  test("les paires écartées par le staff ne reviennent pas", () => {
    const a = compte({
      avatar: avatar(IMAGE_B),
      discordId: flocon(new Date("2021-05-05T00:00:00Z")),
      pseudo: "kazemaru",
    });
    const b = compte({
      avatar: avatar(IMAGE_B),
      discordId: flocon(new Date("2026-01-30T00:00:00Z")),
      pseudo: "kazemaru_alt",
    });
    expect(balayer([a, b]).rapprochements).toHaveLength(1);
    expect(balayer([a, b], { ecartees: new Set([clePaire(a.discordId, b.discordId)]) }).rapprochements).toHaveLength(0);
  });

  test("l'activité n'est demandée que pour les paires candidates", () => {
    const demandes: string[] = [];
    const population = Array.from({ length: 20 }, (_, index) =>
      compte({
        discordId: flocon(new Date(Date.UTC(2020, 0, 1 + index * 40))),
        pseudo: pseudoDistinct(index),
      }),
    );
    balayer(population, {
      activite: (a, b) => {
        demandes.push(clePaire(a, b));
        return null;
      },
    });
    expect(demandes.length).toBeLessThan((20 * 19) / 2);
  });
});

// ─── Présentation ───────────────────────────────────────────────────────────

describe("présentation", () => {
  test("niveauDeScore respecte ses seuils", () => {
    expect(niveauDeScore(0)).toBeNull();
    expect(niveauDeScore(11)).toBeNull();
    expect(niveauDeScore(12)).toBe("faible");
    expect(niveauDeScore(42)).toBe("fort");
    expect(niveauDeScore(100)).toBe("certain");
  });

  test("ecartLisible change d'unité", () => {
    expect(ecartLisible(120_000)).toBe("2 min");
    expect(ecartLisible(3 * 3_600_000)).toBe("3 h");
    expect(ecartLisible(5 * JOUR)).toBe("5 j");
  });

  test("libelleBalayage décrit la liste qu'on lui donne, pas une autre", () => {
    // `balayerServeur` filtre les rapprochements pour l'option `jours` puis
    // rend `{...balayage, rapprochements}` : `parNiveau` restait celui de la
    // liste NON filtrée, et l'embed affichait « 32 rapprochements — 3 faisceaux »
    // au-dessus d'une page qui n'en contenait aucun.
    const a = compte({
      avatar: avatar(IMAGE_B),
      discordId: flocon(new Date("2021-05-05T00:00:00Z")),
      pseudo: "kazemaru",
    });
    const b = compte({
      avatar: avatar(IMAGE_B),
      discordId: flocon(new Date("2026-01-30T00:00:00Z")),
      pseudo: "kazemaru_alt",
    });
    const balayage = balayer([a, b]);
    expect(balayage.rapprochements.length).toBe(1);
    const filtre = { ...balayage, rapprochements: [] };
    expect(libelleBalayage(filtre)).toContain("aucun rapprochement");
  });

  test("libelleBalayage ne suggère aucune sanction", () => {
    const vide = balayer([]);
    expect(libelleBalayage(vide)).toContain("aucun rapprochement");
    const phrase = libelleBalayage(vide).toLowerCase();
    for (const mot of ["bannir", "exclure", "sanction", "expulser"]) {
      expect(phrase).not.toContain(mot);
    }
  });

  test("clePaire ne dépend pas de l'ordre", () => {
    expect(clePaire("100", "200")).toBe(clePaire("200", "100"));
  });
});
