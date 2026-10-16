/**
 * Tests du registre des profils.
 *
 * Trois familles, et aucune n'est décorative :
 *
 *  1. la RÉSOLUTION (profil demandé, jeton, guildes, salon, marque) — c'est ce
 *     qui décide sous quelle identité le processus se connecte ;
 *  2. la DISJONCTION des deux listes de commandes, vérifiée en LISANT les
 *     fichiers, pas à l'œil : deux bots peuvent être présents sur le même
 *     serveur, et deux `/azalee` dans la même liste rendraient le doublon
 *     indiscernable pour le membre ;
 *  3. l'EXISTENCE réelle de chaque module listé sur le disque : un chemin faux
 *     ne se voit pas au type-check (ce sont des chaînes) et tue le bot à
 *     l'import, en production, au démarrage.
 */
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { GatewayIntentBits } from "discord.js";

import { ACHILLEA_GUILD_ID, AZALEE_GUILD_ID, RG_GUILD_ID } from "@rosegriffon/types/discord";

import {
  NOMS_PROFILS,
  PROFILS,
  PROFIL_PAR_DEFAUT,
  VARIABLE_PROFIL,
  couleurDeMarque,
  estNomProfil,
  guildesDuProfil,
  jetonDuProfil,
  messageJetonAbsent,
  profilActif,
  profilDemande,
  salonAnnonceDuProfil,
  urlBaseDuProfil,
  type EnvLisible,
  type NomProfil,
} from "./profil";
// Le contrat que `lib/config.ts` doit pouvoir fabriquer à partir du seul
// registre. `import type` : aucun module de service n'est chargé par ce test.
import type { ProfilAnnonceur } from "../services/tweetsNotifier";

/** Racine de `apps/bot/src`, d'où partent les chemins de modules du registre. */
const RACINE_SRC = new URL("../", import.meta.url);

function fichierDuModule(chemin: string): string {
  return fileURLToPath(new URL(chemin, RACINE_SRC));
}

/**
 * Instant de création encodé dans un flocon Discord : les 42 bits de poids fort
 * comptent les millisecondes depuis l'époque Discord (1er janvier 2015 UTC).
 */
function instantDuFlocon(id: string): number {
  return Number((BigInt(id) >> 22n) + 1420070400000n);
}

describe("profilDemande", () => {
  test("sans variable, le profil est celui d'avant les profils", () => {
    expect(profilDemande({})).toBe("rg");
    expect(PROFIL_PAR_DEFAUT).toBe("rg");
  });

  test("une variable vide ou en espaces vaut absente", () => {
    expect(profilDemande({ [VARIABLE_PROFIL]: "" })).toBe("rg");
    expect(profilDemande({ [VARIABLE_PROFIL]: "   " })).toBe("rg");
  });

  test("le profil demandé est rendu, casse et espaces pardonnées", () => {
    expect(profilDemande({ [VARIABLE_PROFIL]: "azalee" })).toBe("azalee");
    expect(profilDemande({ [VARIABLE_PROFIL]: " AZALEE " })).toBe("azalee");
    expect(profilDemande({ [VARIABLE_PROFIL]: "rg" })).toBe("rg");
  });

  test("une valeur inconnue LÈVE au lieu de retomber sur rg", () => {
    // Le repli silencieux démarrerait un second bot Rose Griffon avec le jeton
    // du premier : chaque interaction traitée deux fois, et rien pour le dire.
    expect(() => profilDemande({ [VARIABLE_PROFIL]: "azalée" })).toThrow(/n'est pas un profil connu/);
    expect(() => profilDemande({ [VARIABLE_PROFIL]: "azale" })).toThrow(/Valeurs acceptées : rg, azalee/);
  });

  test("estNomProfil ne reconnaît que les deux profils", () => {
    expect(estNomProfil("rg")).toBe(true);
    expect(estNomProfil("azalee")).toBe(true);
    expect(estNomProfil("website")).toBe(false);
  });

  test("profilActif rend l'objet du registre", () => {
    expect(profilActif({}).nom).toBe("rg");
    expect(profilActif({ [VARIABLE_PROFIL]: "azalee" }).titre).toBe("Azalée");
  });
});

describe("jetonDuProfil", () => {
  test("rg lit DISCORD_BOT_TOKEN, puis DISCORD_TOKEN — l'ordre historique", () => {
    expect(jetonDuProfil(PROFILS.rg, { DISCORD_BOT_TOKEN: "jeton-rg" })).toBe("jeton-rg");
    expect(jetonDuProfil(PROFILS.rg, { DISCORD_TOKEN: "ancien-nom" })).toBe("ancien-nom");
    expect(jetonDuProfil(PROFILS.rg, { DISCORD_BOT_TOKEN: "prioritaire", DISCORD_TOKEN: "ancien-nom" })).toBe(
      "prioritaire",
    );
  });

  test("azalee n'accepte QUE sa propre variable", () => {
    expect(jetonDuProfil(PROFILS.azalee, { AZALEE_DISCORD_BOT_TOKEN: "jeton-azalee" })).toBe("jeton-azalee");
    // Le jeton de Rose Griffon ne doit jamais servir de repli : deux processus
    // sur la même identité Discord répondent deux fois à chaque interaction.
    expect(() => jetonDuProfil(PROFILS.azalee, { DISCORD_BOT_TOKEN: "jeton-rg" })).toThrow(/AZALEE_DISCORD_BOT_TOKEN/);
  });

  test("un jeton absent dit QUOI faire, et où", () => {
    let message = "";
    try {
      jetonDuProfil(PROFILS.azalee, {});
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toBe(messageJetonAbsent(PROFILS.azalee));
    expect(message).toContain("AZALEE_DISCORD_BOT_TOKEN");
    expect(message).toContain(".env");
    expect(message).toContain("application Discord Azalée");
    expect(message).not.toContain("undefined");
  });

  test("un secret scellé et un $VAR non substitué sont refusés par leur nom", () => {
    expect(() => jetonDuProfil(PROFILS.azalee, { AZALEE_DISCORD_BOT_TOKEN: "eyJ2IjoxLCJrIjoi…" })).toThrow(
      /secret SCELLÉ/,
    );
    expect(() => jetonDuProfil(PROFILS.azalee, { AZALEE_DISCORD_BOT_TOKEN: "$DISCORD_BOT_TOKEN" })).toThrow(
      /non substituée/,
    );
  });
});

describe("guildes", () => {
  test("rg publie par guilde, azalee publie globalement", () => {
    // Deux portées, deux raisons. Le bot Rose Griffon administre UNE communauté
    // (membres, niveaux, accueil) : ses commandes n'ont aucun sens sur un
    // serveur dont il ne connaît ni les membres ni les rôles, donc il reste
    // enregistré serveur par serveur.
    expect(PROFILS.rg.porteeCommandes).toBe("guildes");
    expect(PROFILS.rg.guildes).toEqual([RG_GUILD_ID, AZALEE_GUILD_ID]);

    // Le bot Azalée sert le wiki : les mêmes fiches partout, aucune
    // configuration propre à un serveur. Il est public (`bot_public: true`), et
    // avec un enregistrement par guilde, Achillea l'a invité le 14/8/2026 pour
    // n'y voir qu'un bot en ligne et sans commande. La portée globale est ce
    // qui rend l'invitation suffisante — sans commit, sans redéploiement.
    expect(PROFILS.azalee.porteeCommandes).toBe("globale");
  });

  test("la liste de guildes d'azalee ne sert plus qu'au nettoyage des commandes héritées", () => {
    // Discord ADDITIONNE commandes globales et commandes de guilde : sans
    // effacer les secondes, un membre verrait chaque commande en double. La
    // liste doit donc contenir tout serveur où le bot a PU enregistrer des
    // commandes de guilde par le passé — pas la liste de ceux qu'il sert.
    expect(PROFILS.azalee.guildes).toContain(RG_GUILD_ID);
    expect(PROFILS.azalee.guildes).toContain(AZALEE_GUILD_ID);
    expect(PROFILS.azalee.guildes).toContain(ACHILLEA_GUILD_ID);
  });

  test("chaque profil déclare ses intents, et azalee n'en demande aucun de privilégié", () => {
    // `GuildMembers` est privilégié : demandé sans être coché dans le portail
    // développeur, Discord refuse la connexion (« Used disallowed intents ») et
    // le bot ne démarre pas du tout. Mesuré sur l'application Azalée.
    expect(PROFILS.rg.intents).toContain(GatewayIntentBits.Guilds);
    expect(PROFILS.rg.intents).toContain(GatewayIntentBits.GuildMembers);
    expect(PROFILS.azalee.intents).toEqual([GatewayIntentBits.Guilds]);
    expect(PROFILS.azalee.intents).not.toContain(GatewayIntentBits.GuildMembers);
  });

  test("rg garde la résolution par l'environnement (comportement d'avant)", () => {
    const env: EnvLisible = { DISCORD_EXTRA_GUILD_IDS: "111111111111111111" };
    const guildes = guildesDuProfil(PROFILS.rg, env);
    expect(guildes).toContain(RG_GUILD_ID);
    expect(guildes).toContain(AZALEE_GUILD_ID);
    expect(guildes).toContain("111111111111111111");
    // Achillea fait partie des guildes servies par défaut : le bot y est présent, et
    // avant le 14/8/2026 il y était en ligne sans une seule commande.
    expect(guildes).toContain(ACHILLEA_GUILD_ID);
  });

  test("azalee ignore les guildes supplémentaires posées pour le bot RG", () => {
    // `DISCORD_EXTRA_GUILD_IDS` sert à ouvrir un serveur au bot Rose Griffon.
    // L'hériter ferait apparaître les commandes d'Azalée sur un serveur que
    // personne n'a décidé de lui ouvrir : le registre reste maître.
    const env: EnvLisible = {
      GUILD_ID: RG_GUILD_ID,
      DISCORD_GUILD_ID: RG_GUILD_ID,
      DISCORD_EXTRA_GUILD_IDS: "111111111111111111",
    };
    expect(guildesDuProfil(PROFILS.azalee, env)).toEqual([RG_GUILD_ID, AZALEE_GUILD_ID, ACHILLEA_GUILD_ID]);
    expect(guildesDuProfil(PROFILS.azalee, env)).not.toContain("111111111111111111");
  });
});

describe("annonce des posts X", () => {
  test("le salon d'annonce est figé dans le registre — et la proximité des flocons ne dit RIEN de son serveur", () => {
    const salon = salonAnnonceDuProfil(PROFILS.azalee, {});
    expect(salon).toBe("1349528692086276148");

    // Ce test existe pour figer une erreur de raisonnement, pas une preuve.
    // Le flocon (`(id >> 22n) + 1420070400000` = instant de création) montre
    // que ce salon a été créé sept minutes après la guilde Azalée — ce qui a
    // laissé croire qu'il s'y trouvait. C'est FAUX : l'API le liste parmi les
    // salons de Rose Griffon (`GET /guilds/1072991720268111892/channels`,
    // relevé le 13/8/2026). Une date de création voisine n'implique aucune
    // appartenance, et c'est exactement le genre de déduction qui envoie
    // chercher une panne au mauvais endroit.
    const creationGuildeAzalee = instantDuFlocon(AZALEE_GUILD_ID);
    const creationSalon = instantDuFlocon(salon as string);
    expect(creationSalon - creationGuildeAzalee).toBeLessThan(10 * 60_000);
    expect(new Date(creationGuildeAzalee).toISOString()).toBe("2025-03-12T23:37:54.435Z");
    expect(new Date(creationSalon).toISOString()).toBe("2025-03-12T23:45:13.224Z");
  });

  test("l'environnement peut déplacer le salon sans déploiement", () => {
    expect(salonAnnonceDuProfil(PROFILS.azalee, { AZALEE_DISCORD_NEWS_CHANNEL_ID: "222222222222222222" })).toBe(
      "222222222222222222",
    );
    // Une valeur qui n'est pas un flocon (nom de salon, $VAR) est ignorée.
    expect(salonAnnonceDuProfil(PROFILS.azalee, { AZALEE_DISCORD_NEWS_CHANNEL_ID: "#annonces" })).toBe(
      "1349528692086276148",
    );
  });

  test("rg n'annonce RIEN, même si un salon traîne dans l'environnement", () => {
    // `annoncePosts: null` prime sur toute variable : c'est ce qui garantit que
    // le bot Rose Griffon reste muet pendant qu'Azalée publie, alors que les
    // deux partagent le réglage `settings['tweets.notification']`.
    expect(PROFILS.rg.annoncePosts).toBeNull();
    expect(salonAnnonceDuProfil(PROFILS.rg, {})).toBeNull();
    expect(salonAnnonceDuProfil(PROFILS.rg, { DISCORD_NEWS_CHANNEL_ID: "333333333333333333" })).toBeNull();
  });

  test("le registre s'assemble en `ProfilAnnonceur` sans rien réécrire", () => {
    // `lib/config.ts` doit pouvoir fabriquer l'objet attendu par
    // `services/tweetsNotifier.ts` à partir du seul registre : le salon RÉSOLU
    // (registre + variable d'env) et le curseur. Le type ci-dessous est celui
    // du notifieur, importé en `import type` — s'il change, ce test cesse de
    // compiler, ce qui est exactement le moment où l'on veut le savoir.
    const annonceur: ProfilAnnonceur = {
      nom: PROFILS.azalee.nom,
      annoncePosts: {
        salon: salonAnnonceDuProfil(PROFILS.azalee, {}) ?? "",
        curseur: PROFILS.azalee.annoncePosts?.curseur ?? "",
      },
    };
    expect(annonceur.annoncePosts?.salon).toBe("1349528692086276148");
    expect(annonceur.annoncePosts?.curseur).toBe("azalee");

    // Rose Griffon : `annoncePosts: null` traverse tel quel jusqu'au notifieur,
    // qui ne démarre alors NI minuteur NI abonnement. C'est ce `null` qui rend
    // le bot Rose Griffon muet sans toucher au réglage partagé en base — donc
    // sans faire taire Azalée du même geste.
    const muet: ProfilAnnonceur = { nom: PROFILS.rg.nom, annoncePosts: null };
    expect(muet.annoncePosts).toBeNull();
    expect(PROFILS.rg.annoncePosts).toBeNull();
  });

  test("un seul profil annonce, et son curseur lui est propre", () => {
    // Le curseur EST la mémoire de ce qui a été annoncé. Un seul annonceur
    // aujourd'hui (Azalée) ; le jour où Rose Griffon reprendrait la parole, son
    // curseur devra être DIFFÉRENT, sinon le premier qui publie prive l'autre
    // serveur du post.
    expect(PROFILS.azalee.annoncePosts?.curseur).toBe("azalee");
    const annonceurs = Object.values(PROFILS).filter(p => p.annoncePosts !== null);
    expect(annonceurs.map(p => p.nom)).toEqual(["azalee"]);
    expect(new Set(annonceurs.map(p => p.annoncePosts?.curseur)).size).toBe(annonceurs.length);
  });
});

describe("marque", () => {
  test("chaque profil porte sa couleur, son pied de page et son domaine", () => {
    expect(PROFILS.rg.marque.couleurHex).toBe("#a14b3f");
    expect(PROFILS.rg.marque.piedDePage).toBe("rosegriffon.fr");
    expect(PROFILS.azalee.marque.couleurHex).toBe("#F89C5A");
    expect(PROFILS.azalee.marque.piedDePage).toBe("azalee.rosegriffon.fr");
    expect(PROFILS.azalee.marque.urlBase).toBe("https://azalee.rosegriffon.fr");
  });

  test("couleurDeMarque rend l'entier attendu par discord.js", () => {
    expect(couleurDeMarque("#a14b3f")).toBe(0xa1_4b_3f);
    expect(couleurDeMarque("#F89C5A")).toBe(0xf8_9c_5a);
    expect(() => couleurDeMarque("orange")).toThrow(/couleur de marque invalide/);
  });

  test("les deux profils ne partagent PAS la variable d'URL de base", () => {
    // `infra/systemd/rg-bot.service` pose `WEBSITE_URL=https://rosegriffon.fr`
    // et les deux services lisent le même `.env` racine : une variable commune
    // ferait pointer les liens du bot Azalée vers le site principal.
    expect(PROFILS.rg.marque.variableUrlBase).not.toBe(PROFILS.azalee.marque.variableUrlBase);
    const env: EnvLisible = { WEBSITE_URL: "https://rosegriffon.fr" };
    expect(urlBaseDuProfil(PROFILS.rg, env)).toBe("https://rosegriffon.fr");
    expect(urlBaseDuProfil(PROFILS.azalee, env)).toBe("https://azalee.rosegriffon.fr");
    expect(urlBaseDuProfil(PROFILS.azalee, { AZALEE_WEBSITE_URL: "http://127.0.0.1:3003" })).toBe(
      "http://127.0.0.1:3003",
    );
    // Un `$VAR` non substitué ne doit pas devenir une URL.
    expect(urlBaseDuProfil(PROFILS.rg, { WEBSITE_URL: "$NEXT_PUBLIC_URL" })).toBe("https://rosegriffon.fr");
  });
});

/**
 * Extrait les commandes de PREMIER NIVEAU déclarées par un fichier.
 *
 * Un groupe racine s'écrit `@SlashGroup({ name: "x", … })` ; un sous-groupe
 * porte en plus `root: "…"` et n'ajoute donc aucune commande de premier niveau
 * (`/staff cron statut` reste sous `/staff`). C'est cette distinction qui rend
 * la disjonction mesurable au lieu d'être postulée.
 */
/**
 * Les commandes de PREMIER NIVEAU déclarées par un fichier.
 *
 * Deux formes coexistent dans le dépôt, et il faut les deux :
 *
 *   - `@SlashGroup({ name: "kizuna" })` — une racine à sous-commandes. Les
 *     déclarations portant `root:` sont ignorées : ce sont des sous-groupes
 *     (`/gestion ticket`), pas des racines.
 *   - `@Slash({ name: "profil" })` sur une classe SANS `@SlashGroup` — une
 *     commande plate. `/profil` et `/classement` sont dans ce cas, et une
 *     détection qui ne regardait que les groupes les rendait invisibles au
 *     test : le contrôle de disjonction des deux bots passait alors sans les
 *     voir.
 */
function commandesRacines(source: string): string[] {
  const noms: string[] = [];
  for (const bloc of source.matchAll(/@SlashGroup\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    const corps = bloc[1] ?? "";
    if (/\broot\s*:/.test(corps)) {
      continue;
    }
    const nom = /\bname\s*:\s*"([^"]+)"/.exec(corps);
    if (nom?.[1]) {
      noms.push(nom[1]);
    }
  }

  // Découpe par classe décorée : une commande plate n'est plate que si SA
  // classe ne porte aucun `@SlashGroup`.
  for (const classe of source.split("@Discord()").slice(1)) {
    if (/@SlashGroup\(/.test(classe)) {
      continue;
    }
    for (const bloc of classe.matchAll(/@Slash\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      const nom = /\bname\s*:\s*"([^"]+)"/.exec(bloc[1] ?? "");
      if (nom?.[1]) {
        noms.push(nom[1]);
      }
    }
  }
  return noms;
}

/** Sources des modules d'un profil, lues en parallèle. */
function sourcesDuProfil(nom: NomProfil): Promise<string[]> {
  return Promise.all(PROFILS[nom].modules.map(chemin => Bun.file(fichierDuModule(chemin)).text()));
}

async function commandesDuProfil(nom: NomProfil): Promise<Set<string>> {
  const noms = new Set<string>();
  for (const source of await sourcesDuProfil(nom)) {
    for (const commande of commandesRacines(source)) {
      noms.add(commande);
    }
  }
  return noms;
}

describe("modules de commandes", () => {
  test("chaque module listé existe RÉELLEMENT sur le disque", async () => {
    const chemins = NOMS_PROFILS.flatMap(nom => [...PROFILS[nom].modules]);
    const presences = await Promise.all(
      chemins.map(async chemin => {
        const existe = await Bun.file(fichierDuModule(chemin)).exists();
        return `${chemin} → ${existe ? "présent" : "ABSENT"}`;
      }),
    );
    expect(presences).toEqual(chemins.map(chemin => `${chemin} → présent`));
  });

  test("chaque module listé déclare bien des commandes (@Discord)", async () => {
    const parProfil = await Promise.all(NOMS_PROFILS.map(nom => sourcesDuProfil(nom)));
    for (const [rang, nom] of NOMS_PROFILS.entries()) {
      const chemins = PROFILS[nom].modules;
      const sources = parProfil[rang] ?? [];
      const constats = sources.map((source, index) => `${chemins[index]}:${source.includes("@Discord()")}`);
      expect(constats).toEqual(chemins.map(chemin => `${chemin}:true`));
    }
  });

  test("aucun module n'est chargé par les deux profils", () => {
    const rg = new Set<string>(PROFILS.rg.modules);
    const communs = PROFILS.azalee.modules.filter(chemin => rg.has(chemin));
    expect(communs).toEqual([]);
  });

  test("les deux profils ne se disputent AUCUN nom de commande", async () => {
    const [rg, azalee] = await Promise.all([commandesDuProfil("rg"), commandesDuProfil("azalee")]);

    // Ni l'une ni l'autre ne doit être vide : un ensemble vide rendrait la
    // disjonction vraie sans rien prouver (par exemple si l'extraction cassait).
    expect(rg.size).toBeGreaterThan(5);
    expect(azalee.size).toBeGreaterThan(3);

    const collisions = [...azalee].filter(commande => rg.has(commande)).toSorted();
    expect(collisions).toEqual([]);
  });

  /**
   * Ancienne arborescence, remplacée par `administration/**`, `staff/**`,
   * `azalee-jeu.ts` et `x.ts`. Elle n'est chargée par AUCUN profil et attend sa
   * suppression par l'unité qui en a le périmètre — `commands/azalee.ts`
   * déclare notamment un second groupe `azalee` qui entrerait en collision.
   *
   * Ce jeu ne sert qu'à ce que le test ci-dessous ne le compte pas comme un
   * oubli ; le jour où ces fichiers disparaissent, il devient inerte sans qu'on
   * ait à y toucher (on n'y teste que des fichiers réellement présents).
   */
  const MODULES_OBSOLETES: ReadonlySet<string> = new Set([
    "commands/admin/article.ts",
    "commands/admin/cron.ts",
    "commands/admin/event.ts",
    "commands/admin/settings.ts",
    "commands/admin/stats.ts",
    "commands/admin/stream.ts",
    "commands/admin/team.ts",
    "commands/admin/user.ts",
    "commands/azalee.ts",
    "commands/chronique.ts",
    "commands/event.ts",
    "commands/ievr.ts",
    "commands/member.ts",
    "commands/planning.ts",
    "commands/profil.ts",
    "commands/staff.ts",
    "commands/sync.ts",
    "commands/tweets.ts",
  ]);

  test("aucune commande de la nouvelle arborescence n'est ORPHELINE", async () => {
    // Le vrai risque du registre n'est pas d'y écrire un chemin faux (le test
    // d'existence l'attrape) : c'est d'OUBLIER un fichier écrit ensuite par
    // quelqu'un d'autre. Un module à décorateur que personne n'importe ne
    // produit aucune erreur — la commande n'existe simplement jamais sur
    // Discord, et rien ne le dit. On part donc du disque, pas du registre.
    const listes = new Set<string>(NOMS_PROFILS.flatMap(nom => [...PROFILS[nom].modules]));
    const glob = new Bun.Glob("commands/**/*.ts");
    const orphelins: string[] = [];
    for await (const relatif of glob.scan({ cwd: fileURLToPath(RACINE_SRC) })) {
      const chemin = relatif.replaceAll("\\", "/");
      if (chemin.endsWith(".test.ts") || listes.has(chemin) || MODULES_OBSOLETES.has(chemin)) {
        continue;
      }
      const source = await Bun.file(fichierDuModule(chemin)).text();
      if (source.includes("@Discord()")) {
        orphelins.push(chemin);
      }
    }
    expect(orphelins.toSorted()).toEqual([]);
  });

  test("les commandes attendues sont bien du bon côté", async () => {
    const [rg, azalee] = await Promise.all([commandesDuProfil("rg"), commandesDuProfil("azalee")]);

    // Le wiki et le jeu, et RIEN d'autre. `/article` a rejoint le bot Rose
    // Griffon le 14/8/2026 : il lit les articles des DEUX sites, et son pendant
    // d'écriture (`/gestion article`) vivait déjà là. Séparer la lecture de
    // l'écriture entre deux identités Discord n'avait aucun sens pour le staff,
    // qui utilise les deux dans la même minute (cf. `docs/bot-commandes.md`).
    for (const commande of ["azalee", "cpk", "cdn", "x"]) {
      expect(`${commande}:${azalee.has(commande)}`).toBe(`${commande}:true`);
    }
    expect(`article:${azalee.has("article")}`).toBe("article:false");
    // La communauté, l'administration — et `/staff`, la consultation de
    // l'exploitation : elle parle des services Rose Griffon, elle vit donc sur
    // le bot Rose Griffon.
    for (const commande of [
      "administration",
      "gestion",
      "moderation",
      "agenda",
      "staff",
      "membre",
      "sondage",
      "article",
      // La vie de communauté, arrivée le 14/8/2026.
      "profil",
      "classement",
      "kizuna",
      "collection",
      "personnaliser",
      "ticket",
    ]) {
      expect(`${commande}:${rg.has(commande)}`).toBe(`${commande}:true`);
    }
  });

  test("aucune racine n'est servie par les DEUX bots à la fois", async () => {
    // Les deux bots vivent sur le même serveur. Deux `/article` dans la même
    // liste d'autocomplétion, le membre n'a aucun moyen de savoir laquelle il
    // déclenche — c'est la raison d'être de la disjonction, et elle ne se voit
    // pas en lisant les deux listes de modules côte à côte.
    const [rg, azalee] = await Promise.all([commandesDuProfil("rg"), commandesDuProfil("azalee")]);
    const communes = [...rg].filter(commande => azalee.has(commande));
    expect(communes.toSorted()).toEqual([]);
  });
});

describe("le registre est la seule source des identifiants", () => {
  test("aucun identifiant de guilde ou de salon n'est écrit en dur ailleurs", async () => {
    const identifiants = [RG_GUILD_ID, AZALEE_GUILD_ID, PROFILS.azalee.annoncePosts?.salonId ?? ""].filter(
      valeur => valeur !== "",
    );

    const glob = new Bun.Glob("**/*.ts");
    const fautifs: string[] = [];
    for await (const relatif of glob.scan({ cwd: fileURLToPath(RACINE_SRC) })) {
      const chemin = relatif.replaceAll("\\", "/");
      if (chemin === "lib/profil.ts" || chemin === "lib/profil.test.ts") {
        continue;
      }
      const source = await Bun.file(fichierDuModule(chemin)).text();
      for (const identifiant of identifiants) {
        if (source.includes(identifiant)) {
          fautifs.push(`${chemin} → ${identifiant}`);
        }
      }
    }
    expect(fautifs).toEqual([]);
  });
});
