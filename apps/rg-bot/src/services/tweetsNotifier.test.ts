/**
 * Tests de l'annonce des nouveaux posts X, PAR PROFIL.
 *
 * Rien ne touche la base ni Discord : les quatre portes de `services/tweets.ts`
 * qui parlent à Postgres (`lireFiltreNotification`, `lireCurseur`,
 * `assurerCurseur`, `tweetsAPublier`, `avancerCurseur`) sont doublées, et le
 * client Discord est un objet factice. Les fonctions PURES du même module
 * (`normaliserCanal`, `salonAnnonce`, `annonceHistorique`) restent les vraies :
 * le module réel est importé AVANT d'être doublé, puis réétalé dans le double.
 * Un test qui doublerait aussi les fonctions pures ne testerait plus rien.
 *
 * Les identifiants de salon employés ici sont FICTIFS. Le vrai salon d'annonce
 * d'Azalée n'a sa place que dans le registre de profils (`lib/profil.ts`) — s'il
 * était recopié dans un test, il finirait recopié ailleurs.
 *
 * Preuve complémentaire, faite sur la vraie base le 13/8/2026 (transaction
 * annulée, aucune écriture) : `INSERT … (canal, curseur_le) VALUES ('azalee',
 * now()) ON CONFLICT (canal) DO NOTHING RETURNING …` crée bien une SECONDE
 * ligne, à `now()`, sans toucher celle de `discord` — la clé primaire de
 * `tweet_notification_curseurs` est `canal`.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Client } from "discord.js";

import { estAnnoncable, estReponse, estRetweet } from "../lib/tweets-format";
import type { FiltreTweets, LigneTweet } from "../lib/tweets-format";
import type { Curseur } from "./tweets";

const servicesReels = await import("./tweets");

// ── État piloté par chaque test ────────────────────────────────────────────
let filtreCourant: FiltreTweets;
let curseurCourant: Curseur | null;
let tweetsCourants: LigneTweet[];
let avancementAccepte: boolean;
/**
 * Curseurs suspendus, DOUBLÉS.
 *
 * Sans ce double, `curseursEnPause()` interroge la VRAIE table `settings` : le
 * jour où un profil y est mis en pause en production, la moitié de ces tests
 * bascule en « inactif » et échoue sans que rien n'ait changé dans le code.
 * C'est arrivé le 13/8/2026, quelques minutes après la mise en pause d'Azalée.
 */
let pauseCourante: string[];

interface Appels {
  filtre: number;
  assurer: string[];
  lire: string[];
  avance: Array<{ canal: string; attendu: Date; jusqua: Date; id: string | null; publies: number }>;
}
let appels: Appels;

await mock.module("./tweets", () => ({
  ...servicesReels,
  curseursEnPause: async (): Promise<string[]> => pauseCourante,
  lireFiltreNotification: async (): Promise<FiltreTweets> => {
    appels.filtre += 1;
    return filtreCourant;
  },
  assurerCurseur: async (canal = "discord"): Promise<Curseur | null> => {
    appels.assurer.push(canal);
    return curseurCourant;
  },
  lireCurseur: async (canal = "discord"): Promise<Curseur | null> => {
    appels.lire.push(canal);
    return curseurCourant;
  },
  tweetsAPublier: async (): Promise<LigneTweet[]> => tweetsCourants,
  avancerCurseur: async (
    canal: string,
    attendu: Date,
    jusqua: Date,
    id: string | null,
    publies: number,
  ): Promise<boolean> => {
    appels.avance.push({ canal, attendu, jusqua, id, publies });
    return avancementAccepte;
  },
}));

const { drainerTweets, demarrerNotifieurTweets, ligneJournal, resoudreSalon } = await import("./tweetsNotifier");
const { annonceHistorique, normaliserCanal, salonAnnonce } = servicesReels;

// ── Doublures ──────────────────────────────────────────────────────────────

/** Salons fictifs : deux profils, deux destinations, aucune valeur de production. */
const SALON_RG = "111111111111111111";
const SALON_AZALEE = "222222222222222222";

const ANNONCE_RG = { salon: SALON_RG, curseur: "discord" } as const;
const ANNONCE_AZALEE = { salon: SALON_AZALEE, curseur: "azalee" } as const;

interface Envoi {
  salonId: string;
  nonce: unknown;
  enforceNonce: unknown;
  embeds: number;
}

function clientFactice(envois: Envoi[], comportement: { echec?: string; nonEcrivable?: boolean } = {}): Client {
  return {
    channels: {
      fetch: async (id: string) => {
        if (comportement.echec) {
          throw new Error(comportement.echec);
        }
        return {
          isSendable: () => comportement.nonEcrivable !== true,
          send: async (options: { embeds?: unknown[]; nonce?: unknown; enforceNonce?: unknown }) => {
            envois.push({
              salonId: id,
              nonce: options.nonce,
              enforceNonce: options.enforceNonce,
              embeds: options.embeds?.length ?? 0,
            });
            return {};
          },
        };
      },
    },
  } as unknown as Client;
}

function tweetFactice(id: string, quand: string): LigneTweet {
  return {
    id,
    text: "Nouvelle bande-annonce d'Inazuma Eleven: Victory Road.",
    created_at: quand,
    author_username: "inazuma_project",
    author_name: "Inazuma Eleven",
    media: null,
    metrics: null,
    is_thread: false,
    tweet_count: 1,
    translation: null,
    category: null,
  };
}

function curseurFactice(canal: string, quand: string, cree: boolean): Curseur {
  return {
    canal,
    curseurLe: new Date(quand),
    dernierTweetId: null,
    annonces: 0,
    cree,
  };
}

beforeEach(() => {
  filtreCourant = {
    actif: true,
    comptes: ["inazuma_project"],
    categories_exclues: ["fan-content"],
    max_par_lot: 5,
    salon: null,
  };
  curseurCourant = curseurFactice("discord", "2026-08-13T00:00:00.000Z", false);
  tweetsCourants = [];
  avancementAccepte = true;
  pauseCourante = [];
  appels = { filtre: 0, assurer: [], lire: [], avance: [] };
});

/** Capture `console.info`/`console.warn` le temps d'un appel. */
async function sansJournal<T>(action: () => T | Promise<T>): Promise<{ valeur: T; lignes: string[] }> {
  const lignes: string[] = [];
  const infoOrigine = console.info;
  const warnOrigine = console.warn;
  const errorOrigine = console.error;
  console.info = (...args: unknown[]) => void lignes.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => void lignes.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void lignes.push(args.map(String).join(" "));
  try {
    const valeur = await action();
    return { valeur, lignes };
  } finally {
    console.info = infoOrigine;
    console.warn = warnOrigine;
    console.error = errorOrigine;
  }
}

afterAll(() => {
  mock.restore();
});

// ───────────────────────────────────────────────────────────────────────────

describe("normaliserCanal", () => {
  test("accepte les deux canaux réels et normalise la casse et les espaces", () => {
    expect(normaliserCanal("discord")).toBe("discord");
    expect(normaliserCanal("azalee")).toBe("azalee");
    expect(normaliserCanal("  Azalee  ")).toBe("azalee");
    expect(normaliserCanal("rg_2")).toBe("rg_2");
    expect(normaliserCanal("rose-griffon")).toBe("rose-griffon");
  });

  test("refuse tout ce qui ferait une clé primaire douteuse", () => {
    // Une clé vide ou fantaisiste créerait une ligne qu'aucun démarrage ne
    // retrouverait : ce serait une amorce à chaque redémarrage, donc des posts
    // perdus en silence plutôt qu'une panne visible.
    expect(normaliserCanal("")).toBeNull();
    expect(normaliserCanal("   ")).toBeNull();
    expect(normaliserCanal(null)).toBeNull();
    expect(normaliserCanal(undefined)).toBeNull();
    expect(normaliserCanal("deux mots")).toBeNull();
    expect(normaliserCanal("-tiret-en-tete")).toBeNull();
    expect(normaliserCanal("canal!")).toBeNull();
    expect(normaliserCanal("a".repeat(33))).toBeNull();
    expect(normaliserCanal("a".repeat(32))).toBe("a".repeat(32));
  });
});

describe("salonAnnonce", () => {
  test("le profil historique laisse le réglage partagé décider", () => {
    expect(salonAnnonce(ANNONCE_RG, { salon: "333333333333333333" })).toBe("333333333333333333");
    expect(salonAnnonce(ANNONCE_RG, { salon: null })).toBe(SALON_RG);
    expect(salonAnnonce(ANNONCE_RG, { salon: "   " })).toBe(SALON_RG);
  });

  test("un autre profil ignore le réglage partagé — un salon appartient à une guilde", () => {
    // C'est LE piège du second bot : `settings['tweets.notification']` est une
    // ligne unique. Si Azalée la suivait, régler le salon côté Rose Griffon
    // enverrait ses annonces vers un serveur où son bot n'est pas présent.
    expect(salonAnnonce(ANNONCE_AZALEE, { salon: "333333333333333333" })).toBe(SALON_AZALEE);
    expect(salonAnnonce(ANNONCE_AZALEE, { salon: null })).toBe(SALON_AZALEE);
  });

  test("aucun salon nulle part vaut `null`, pas une chaîne vide", () => {
    expect(salonAnnonce({ salon: "", curseur: "azalee" }, { salon: null })).toBeNull();
    expect(salonAnnonce({ salon: "  ", curseur: "discord" }, { salon: "" })).toBeNull();
  });

  test("le profil historique garde son curseur et son salon d'environnement", () => {
    const historique = annonceHistorique();
    expect(historique.curseur).toBe("discord");
    expect(historique.salon).toBe(Bun.env.DISCORD_NEWS_CHANNEL_ID?.trim() ?? "");
  });
});

describe("ligneJournal", () => {
  const contexte = { origine: "filet", canal: "azalee" };

  test("un tour nominal ne dit rien", () => {
    const trace = ligneJournal({ etat: "rien", candidats: 0, publies: 0 }, contexte, null);
    expect(trace.ligne).toBeNull();
    expect(trace.empreinte).toBeNull();
  });

  test("une cause qui dure n'est écrite qu'une fois", () => {
    const resultat = {
      etat: "sans-salon" as const,
      candidats: 3,
      publies: 0,
      detail: "Salon injoignable (Unknown Channel)",
    };
    const premier = ligneJournal(resultat, contexte, null);
    expect(premier.ligne).toContain("sans-salon");
    expect(premier.ligne).toContain("[tweets:azalee]");
    expect(premier.niveau).toBe("warn");

    const second = ligneJournal(resultat, contexte, premier.empreinte);
    expect(second.ligne).toBeNull();
    expect(second.empreinte).toBe(premier.empreinte);

    // Cause différente = nouvelle information, donc nouvelle ligne.
    const autre = ligneJournal(
      { ...resultat, detail: "Salon injoignable (Missing Access)" },
      contexte,
      second.empreinte,
    );
    expect(autre.ligne).not.toBeNull();
  });

  test("le retour à la normale est signalé une fois, puis c'est le silence", () => {
    const bloque = ligneJournal(
      { etat: "echec", candidats: 0, publies: 0, detail: "base injoignable" },
      contexte,
      null,
    );
    const repris = ligneJournal({ etat: "rien", candidats: 0, publies: 0 }, contexte, bloque.empreinte);
    expect(repris.ligne).toContain("la cause du blocage précédent a disparu");
    expect(repris.empreinte).toBeNull();

    const suivant = ligneJournal({ etat: "rien", candidats: 0, publies: 0 }, contexte, repris.empreinte);
    expect(suivant.ligne).toBeNull();
  });

  test("une publication et une amorce sont toujours tracées", () => {
    expect(ligneJournal({ etat: "publie", candidats: 2, publies: 2 }, contexte, null).ligne).toContain("2/2");
    expect(ligneJournal({ etat: "amorce", candidats: 0, publies: 0, detail: "créé" }, contexte, null).ligne).toContain(
      "amorce",
    );
  });
});

describe("drainerTweets — un curseur par profil", () => {
  test("le premier démarrage d'un profil ne rejoue pas l'archive", async () => {
    // VERROU N°2. `assurerCurseur` a créé la ligne « azalee » à `now()` :
    // `cree: true` fait sortir le drain AVANT toute lecture de posts, tout
    // envoi et toute avancée de curseur.
    curseurCourant = curseurFactice("azalee", "2026-08-13T09:00:00.000Z", true);
    const envois: Envoi[] = [];

    const { valeur: resultat } = await sansJournal(() =>
      drainerTweets(clientFactice(envois), { annonce: ANNONCE_AZALEE }),
    );

    expect(resultat.etat).toBe("amorce");
    expect(resultat.publies).toBe(0);
    expect(resultat.candidats).toBe(0);
    expect(resultat.detail).toContain("ni l'archive ni l'arriéré");
    expect(envois).toHaveLength(0);
    expect(appels.avance).toHaveLength(0);
    // Et c'est bien SON canal qui a été amorcé, pas celui de Rose Griffon.
    expect(appels.assurer).toEqual(["azalee"]);
    expect(appels.lire).toHaveLength(0);
  });

  test("chaque profil avance sa propre ligne de curseur", async () => {
    curseurCourant = curseurFactice("azalee", "2026-08-13T00:00:00.000Z", false);
    tweetsCourants = [tweetFactice("1955000000000000001", "2026-08-13T08:00:00.000Z")];
    const envois: Envoi[] = [];

    const { valeur: resultat } = await sansJournal(() =>
      drainerTweets(clientFactice(envois), { annonce: ANNONCE_AZALEE }),
    );

    expect(resultat.etat).toBe("publie");
    expect(resultat.publies).toBe(1);
    expect(envois).toHaveLength(1);
    // Le salon vient du registre du profil, pas du réglage partagé.
    expect(envois[0]?.salonId).toBe(SALON_AZALEE);
    // VERROU N°4 : nonce + `enforceNonce` sur chaque envoi.
    expect(envois[0]?.enforceNonce).toBe(true);
    expect(String(envois[0]?.nonce)).toStartWith("tw0-");
    expect(appels.avance).toHaveLength(1);
    expect(appels.avance[0]?.canal).toBe("azalee");
    // Échange-comparaison : la position ATTENDUE est celle qui a été lue.
    expect(appels.avance[0]?.attendu.toISOString()).toBe("2026-08-13T00:00:00.000Z");
    expect(appels.avance[0]?.publies).toBe(1);
  });

  test("sans profil, le drain reste celui de Rose Griffon", async () => {
    curseurCourant = curseurFactice("discord", "2026-08-13T00:00:00.000Z", false);
    tweetsCourants = [tweetFactice("1955000000000000002", "2026-08-13T08:00:00.000Z")];
    filtreCourant = { ...filtreCourant, salon: SALON_RG };
    const envois: Envoi[] = [];

    const { valeur: resultat } = await sansJournal(() => drainerTweets(clientFactice(envois), {}));

    expect(resultat.etat).toBe("publie");
    expect(appels.assurer).toEqual(["discord"]);
    expect(appels.avance[0]?.canal).toBe("discord");
    expect(envois[0]?.salonId).toBe(SALON_RG);
  });

  test("un curseur mal nommé arrête le drain avant toute écriture", async () => {
    const envois: Envoi[] = [];
    const { valeur: resultat } = await sansJournal(() =>
      drainerTweets(clientFactice(envois), {
        annonce: { salon: SALON_AZALEE, curseur: "Az alée !" },
      }),
    );

    expect(resultat.etat).toBe("echec");
    expect(resultat.detail).toContain("annoncePosts.curseur");
    expect(appels.assurer).toHaveLength(0);
    expect(appels.filtre).toBe(0);
    expect(envois).toHaveLength(0);
  });

  test("un salon injoignable n'avance jamais le curseur et explique l'invitation manquante", async () => {
    // Cas NORMAL au premier démarrage : le bot Azalée n'est pas encore autorisé
    // sur sa guilde, l'API répond « Unknown Channel ».
    curseurCourant = curseurFactice("azalee", "2026-08-13T00:00:00.000Z", false);
    tweetsCourants = [tweetFactice("1955000000000000003", "2026-08-13T08:00:00.000Z")];
    const envois: Envoi[] = [];

    const { valeur: resultat } = await sansJournal(() =>
      drainerTweets(clientFactice(envois, { echec: "Unknown Channel" }), {
        annonce: ANNONCE_AZALEE,
      }),
    );

    expect(resultat.etat).toBe("sans-salon");
    expect(resultat.publies).toBe(0);
    expect(resultat.candidats).toBe(1);
    expect(resultat.detail).toContain("pas encore invité");
    expect(appels.avance).toHaveLength(0);
    expect(envois).toHaveLength(0);
  });

  test("aucun salon nulle part : le profil le dit au lieu de publier au hasard", async () => {
    curseurCourant = curseurFactice("azalee", "2026-08-13T00:00:00.000Z", false);
    tweetsCourants = [tweetFactice("1955000000000000004", "2026-08-13T08:00:00.000Z")];
    filtreCourant = { ...filtreCourant, salon: SALON_RG };
    const envois: Envoi[] = [];

    const { valeur: resultat } = await sansJournal(() =>
      drainerTweets(clientFactice(envois), { annonce: { salon: "", curseur: "azalee" } }),
    );

    expect(resultat.etat).toBe("sans-salon");
    expect(resultat.detail).toContain("annoncePosts.salon");
    expect(appels.avance).toHaveLength(0);
  });

  test("la simulation ne crée ni n'avance aucun curseur", async () => {
    curseurCourant = curseurFactice("azalee", "2026-08-13T00:00:00.000Z", false);
    tweetsCourants = [tweetFactice("1955000000000000005", "2026-08-13T08:00:00.000Z")];
    const envois: Envoi[] = [];

    const { valeur: resultat } = await sansJournal(() =>
      drainerTweets(clientFactice(envois), { annonce: ANNONCE_AZALEE, simulation: true }),
    );

    expect(resultat.etat).toBe("publie");
    expect(appels.lire).toEqual(["azalee"]);
    expect(appels.assurer).toHaveLength(0);
    expect(appels.avance).toHaveLength(0);
    expect(envois).toHaveLength(0);
  });

  test("un curseur déplacé par un autre drain arrête la publication", async () => {
    curseurCourant = curseurFactice("azalee", "2026-08-13T00:00:00.000Z", false);
    tweetsCourants = [tweetFactice("1955000000000000006", "2026-08-13T08:00:00.000Z")];
    avancementAccepte = false;
    const envois: Envoi[] = [];

    const { valeur: resultat } = await sansJournal(() =>
      drainerTweets(clientFactice(envois), { annonce: ANNONCE_AZALEE }),
    );

    expect(resultat.etat).toBe("concurrent");
    expect(appels.avance).toHaveLength(1);
  });
});

describe("resoudreSalon", () => {
  test("la même panne n'est journalisée qu'une fois", async () => {
    const salonInconnu = "444444444444444444";
    const client = clientFactice([], { echec: "Unknown Channel" });

    const { valeur, lignes } = await sansJournal(async () => {
      const premier = await resoudreSalon(client, salonInconnu);
      const second = await resoudreSalon(client, salonInconnu);
      return { premier, second };
    });

    expect(valeur.premier.salon).toBeNull();
    expect(valeur.second.salon).toBeNull();
    // La raison est TOUJOURS renvoyée (elle remonte à l'admin), mais elle n'est
    // écrite au journal qu'une fois : cinq minutes suffiraient sinon à noyer le
    // journal du service pendant des jours.
    expect(valeur.second.raison).toContain("Unknown Channel");
    expect(lignes).toHaveLength(1);
  });

  test("un salon non écrivable est expliqué, pas confondu avec une absence", async () => {
    const { valeur } = await sansJournal(() =>
      resoudreSalon(clientFactice([], { nonEcrivable: true }), "555555555555555555"),
    );
    expect(valeur.salon).toBeNull();
    expect(valeur.raison).toContain("Envoyer des messages");
  });
});

describe("demarrerNotifieurTweets", () => {
  test("un profil sans salon d'annonce ne démarre rien, et le dit une seule fois", async () => {
    const envois: Envoi[] = [];
    const { valeur: arreter, lignes } = await sansJournal(() =>
      demarrerNotifieurTweets(clientFactice(envois), { nom: "azalee" }),
    );

    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toContain("azalee");
    expect(lignes[0]).toContain("annoncePosts");
    // Aucun tour : ni lecture de réglage, ni curseur, ni envoi. Donc rien à
    // répéter toutes les cinq minutes.
    expect(appels.filtre).toBe(0);
    expect(appels.assurer).toHaveLength(0);
    expect(envois).toHaveLength(0);
    expect(() => arreter()).not.toThrow();
  });

  test("`annoncePosts: null` vaut « ce profil n'annonce pas »", async () => {
    const { lignes } = await sansJournal(() =>
      demarrerNotifieurTweets(clientFactice([]), { nom: "azalee", annoncePosts: null }),
    );
    expect(lignes).toHaveLength(1);
    expect(appels.filtre).toBe(0);
  });

  test("un profil complet amorce SON curseur et s'arrête sans laisser de socket", async () => {
    curseurCourant = curseurFactice("azalee", "2026-08-13T09:00:00.000Z", true);
    const envois: Envoi[] = [];

    const { lignes } = await sansJournal(async () => {
      const arreter = demarrerNotifieurTweets(clientFactice(envois), {
        nom: "azalee",
        annoncePosts: ANNONCE_AZALEE,
      });
      // Arrêt demandé AVANT que l'import paresseux du pont cron ne se résolve :
      // c'est la course que le drapeau d'abandon doit gagner. Sans lui, une
      // socket s'ouvrirait après coup et plus personne ne la fermerait.
      arreter();
      await Bun.sleep(25);
    });

    expect(appels.assurer).toEqual(["azalee"]);
    expect(envois).toHaveLength(0);
    expect(lignes.some(ligne => ligne.includes("notifieur démarré"))).toBe(true);
    expect(lignes.some(ligne => ligne.includes("abonné au pont"))).toBe(false);
  });

  test("un curseur mal nommé dans le registre ne démarre pas non plus", async () => {
    const { valeur: arreter, lignes } = await sansJournal(() =>
      demarrerNotifieurTweets(clientFactice([]), {
        nom: "azalee",
        annoncePosts: { salon: SALON_AZALEE, curseur: "" },
      }),
    );
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toContain("curseur");
    expect(appels.filtre).toBe(0);
    expect(() => arreter()).not.toThrow();
  });
});

describe("ni retweet, ni réponse dans un salon d'annonces", () => {
  /*
   * Le bot Azalée annonçait les retweets et les réponses de @Azalee_IE dans le
   * salon d'annonces. Un retweet y publie le post de QUELQU'UN D'AUTRE sous le
   * nom du compte suivi ; une réponse est la moitié d'une conversation,
   * incompréhensible hors de son fil et bien plus fréquente qu'une annonce.
   *
   * Les deux se reconnaissent au TEXTE : `public.tweets` ne porte aucune colonne
   * qui les distingue (relevé le 13/8/2026 — ni `is_retweet`, ni `in_reply_to`).
   */

  test("un retweet est reconnu", () => {
    expect(estRetweet("RT @inazuma_project: La mise à jour est là")).toBe(true);
    expect(estRetweet("  RT @Level5Hub: annonce")).toBe(true);
  });

  test("un post qui PARLE d'un retweet n'en est pas un", () => {
    // La règle doit rester étroite : trop large, elle fait disparaître de vraies
    // annonces sans que personne ne le sache.
    expect(estRetweet("Merci pour vos RT @inazuma_project !")).toBe(false);
    expect(estRetweet("RT sans deux-points @machin")).toBe(false);
  });

  test("une réponse est reconnue, y compris à plusieurs comptes", () => {
    expect(estReponse("@inazuma_cross merci !")).toBe(true);
    expect(estReponse("@a @b @c oui")).toBe(true);
    expect(estReponse("  @Azalee_IE bien joué")).toBe(true);
  });

  test("un post ORDINAIRE qui commence par une mention reste annonçable", () => {
    // C'est le faux positif à ne pas commettre : « @inazuma_project vient
    // d'annoncer… » est une annonce, pas une réponse. On ne peut pas les
    // distinguer par le seul texte, et le doute profite à la publication —
    // mieux vaut une annonce de trop qu'une annonce perdue en silence.
    expect(estReponse("Voici la mise à jour de @inazuma_project")).toBe(false);
    expect(estReponse("La mise à jour 7.1.0 de Victory Road est sortie ⚡️")).toBe(false);
  });

  test("un texte vide ou absent est annonçable — ce n'est pas ce filtre qui l'écarte", () => {
    expect(estRetweet(null)).toBe(false);
    expect(estReponse(undefined)).toBe(false);
    expect(estAnnoncable("")).toBe(true);
  });

  test("estAnnoncable réunit les deux règles", () => {
    expect(estAnnoncable("RT @x: coucou")).toBe(false);
    expect(estAnnoncable("@x coucou")).toBe(false);
    expect(estAnnoncable("La mise à jour 7.1.0 est sortie ⚡️")).toBe(true);
  });
});

describe("pause par profil", () => {
  /*
   * `FiltreTweets.actif` existe déjà, mais il vit dans le réglage PARTAGÉ :
   * le baisser couperait les DEUX bots. Cette pause-ci porte sur un curseur,
   * donc sur un seul profil — c'est ce qui a permis de suspendre Azalée le
   * 13/8/2026 sans faire taire Rose Griffon.
   */

  test("un curseur suspendu ne publie RIEN et le dit", async () => {
    pauseCourante = ["azalee"];
    tweetsCourants = [tweetFactice("1", "2026-08-13T10:00:00Z")];
    const envois: Envoi[] = [];

    const { valeur: resultat } = await sansJournal(() =>
      drainerTweets(clientFactice(envois), { annonce: ANNONCE_AZALEE }),
    );

    expect(resultat.etat).toBe("inactif");
    expect(resultat.publies).toBe(0);
    expect(envois).toHaveLength(0);
  });

  test("suspendre un profil n'en suspend AUCUN autre", async () => {
    // C'est toute la raison d'être de ce réglage : le bot Rose Griffon doit
    // continuer à faire son travail pendant qu'on répare celui d'Azalée.
    pauseCourante = ["azalee"];
    tweetsCourants = [tweetFactice("1", "2026-08-13T10:00:00Z")];
    const envois: Envoi[] = [];

    // Sans `annonce`, le drain retombe sur le profil HISTORIQUE (curseur
    // `discord`), c'est-à-dire le bot Rose Griffon.
    const { valeur: resultat } = await sansJournal(() => drainerTweets(clientFactice(envois), {}));

    expect(resultat.etat).not.toBe("inactif");
  });

  test("un réglage vide ou illisible NE SUSPEND RIEN", async () => {
    // Un réglage cassé ne doit pas faire taire les bots en silence : c'est la
    // panne la plus difficile à voir, puisqu'elle ressemble à « rien à annoncer ».
    pauseCourante = [];
    tweetsCourants = [tweetFactice("1", "2026-08-13T10:00:00Z")];

    const { valeur: resultat } = await sansJournal(() => drainerTweets(clientFactice([]), { annonce: ANNONCE_AZALEE }));

    expect(resultat.etat).not.toBe("inactif");
  });
});

describe("liste de comptes par profil", () => {
  /*
   * Le salon d'annonce d'Azalée porte la marque Azalée. Le réglage PARTAGÉ,
   * lui, suit huit comptes (Level5, comptes officiels Inazuma, Rose Griffon,
   * Azalée) : c'est la bonne liste pour une veille thématique, pas pour un
   * salon d'annonce. Constaté le 13/8/2026 — la première carte de validation
   * proposée portait un post de `@rose_griffon`.
   */

  /** Le profil Azalée tel que le registre le déclare : un seul compte. */
  const ANNONCE_AZALEE_MARQUE = {
    ...ANNONCE_AZALEE,
    comptes: ["Azalee_IE"],
  } as const;

  test("un post d'un AUTRE compte n'est pas retenu", async () => {
    tweetsCourants = [{ ...tweetFactice("1", "2026-08-13T10:00:00Z"), author_username: "rose_griffon" }];
    const envois: Envoi[] = [];

    const { valeur: resultat } = await sansJournal(() =>
      drainerTweets(clientFactice(envois), { annonce: ANNONCE_AZALEE_MARQUE }),
    );

    expect(resultat.publies).toBe(0);
    expect(envois).toHaveLength(0);
  });

  test("un post du compte de la marque est retenu", async () => {
    tweetsCourants = [{ ...tweetFactice("1", "2026-08-13T10:00:00Z"), author_username: "Azalee_IE" }];
    const envois: Envoi[] = [];

    const { valeur: resultat } = await sansJournal(() =>
      drainerTweets(clientFactice(envois), { annonce: ANNONCE_AZALEE_MARQUE }),
    );

    expect(resultat.publies).toBe(1);
  });

  test("sans liste déclarée, le réglage PARTAGÉ s'applique — le profil historique ne change pas", async () => {
    // Rose Griffon n'a pas de liste propre : son comportement doit rester
    // exactement celui d'avant cette option. Le réglage partagé du test suit
    // `inazuma_project`, et c'est bien lui qui décide.
    tweetsCourants = [tweetFactice("1", "2026-08-13T10:00:00Z")];

    const { valeur: publie } = await sansJournal(() => drainerTweets(clientFactice([]), { annonce: ANNONCE_AZALEE }));
    expect(publie.publies).toBe(1);

    // Et le même post, sous une liste de profil qui ne le contient pas, ne part
    // pas : c'est bien la liste du PROFIL qui l'emporte quand elle existe.
    curseurCourant = curseurFactice("azalee", "2026-08-13T00:00:00.000Z", false);
    tweetsCourants = [tweetFactice("2", "2026-08-13T11:00:00Z")];

    const { valeur: ecarte } = await sansJournal(() =>
      drainerTweets(clientFactice([]), { annonce: ANNONCE_AZALEE_MARQUE }),
    );
    expect(ecarte.publies).toBe(0);
  });
});

describe("validation humaine — le curseur avance AVANT la carte", () => {
  /*
   * La boucle du 13 au 24/8/2026 : l'échange-comparaison échouait à tous les
   * coups (microsecondes de `timestamptz` contre millisecondes de `Date`), le
   * curseur restait figé, et le drain redéposait la MÊME carte de validation
   * toutes les cinq minutes — 188 exemplaires du même post dans
   * `🌿📰〡général-azalée`. Le refus était muet : l'état renvoyé restait
   * « propose ». Deux garde-fous depuis : on avance d'abord, et un refus
   * arrête le drain au lieu de déposer une carte de plus.
   */
  const SALON_VALIDATION = "333333333333333333";
  const ANNONCE_VALIDEE = { ...ANNONCE_AZALEE, salonValidation: SALON_VALIDATION } as const;

  test("le curseur avance avant l'envoi, et la carte part dans le salon de validation", async () => {
    curseurCourant = curseurFactice("azalee", "2026-08-13T00:00:00.000Z", false);
    tweetsCourants = [tweetFactice("1", "2026-08-13T10:00:00Z")];
    const envois: Envoi[] = [];

    const { valeur: resultat } = await sansJournal(() =>
      drainerTweets(clientFactice(envois), { annonce: ANNONCE_VALIDEE }),
    );

    expect(resultat.etat).toBe("propose");
    expect(resultat.publies).toBe(1);
    expect(appels.avance).toHaveLength(1);
    expect(appels.avance[0]!.jusqua.toISOString()).toBe("2026-08-13T10:00:00.000Z");
    // Rien dans le salon d'annonce : la publication attend un clic.
    expect(envois.map(e => e.salonId)).toEqual([SALON_VALIDATION]);
  });

  test("un curseur refusé n'envoie AUCUNE carte", async () => {
    curseurCourant = curseurFactice("azalee", "2026-08-13T00:00:00.000Z", false);
    tweetsCourants = [tweetFactice("1", "2026-08-13T10:00:00Z")];
    avancementAccepte = false;
    const envois: Envoi[] = [];

    const { valeur: resultat } = await sansJournal(() =>
      drainerTweets(clientFactice(envois), { annonce: ANNONCE_VALIDEE }),
    );

    expect(resultat.etat).toBe("concurrent");
    expect(resultat.publies).toBe(0);
    expect(envois).toHaveLength(0);
  });
});
