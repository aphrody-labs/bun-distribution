import {
  BOUTONS_PAR_RANGEE,
  borner,
  COULEUR_MARQUE,
  emotesRoseGriffon,
  LIMITE_AUTEUR,
  LIMITE_CONTENU,
  LIMITE_DESCRIPTION,
  LIMITE_LIBELLE_BOUTON,
  LIMITE_PIED,
  LIMITE_TITRE,
  RANGEES_PAR_MESSAGE,
} from "@rosegriffon/types/discord";

import { SITE_URL } from "@/lib/site-url";

import type { PoidsMode, SourceTirage } from "./tirage";
import { urlImageAsset } from "./types";

/*
 * LA CHARGE DU MESSAGE D'ANNONCE — MODULE PUR, SANS BASE NI RÉSEAU.
 *
 * ── POURQUOI CE FICHIER EST SÉPARÉ DE `annonce-discord.ts` ────────────────
 * Le module frère porte `import "server-only"` et ouvre le pool Postgres : il
 * n'est donc PAS importable depuis `bun test` — `server-only` n'y est même pas
 * résolvable. Or c'est justement cette moitié-ci qu'il faut tester, parce que
 * c'est elle qui décide ce que la communauté lit, et qu'une charge violant une
 * limite de l'API fait refuser le message ENTIER, embed compris : personne ne
 * voit alors rien, pas même une erreur partielle. L'annonce est silencieusement
 * perdue et le staff croit avoir annoncé.
 *
 * Même doctrine que `lib/wiki/<x>.ts` + `<x>-shared.ts` côté azalée : la partie
 * qui touche Node reste d'un côté, la partie pure et testable de l'autre.
 * Toutes les bornes viennent de `@rosegriffon/types/discord`, partagées avec le
 * relais de campagne du démon cron.
 *
 * ── CE MODULE NE DÉCIDE JAMAIS D'ANNONCER ─────────────────────────────────
 * Il sait construire une charge. Il ne sait pas si elle DOIT partir : cette
 * décision est un geste d'admin explicite, confirmé au clavier, pris dans
 * `app/admin/iergday/actions-tirage.ts` — jamais un cron, jamais un trigger,
 * jamais un effet de bord de `effectuerTirage` ou de `publierTirage`. C'est la
 * règle absolue du projet : aucune publication publique automatique.
 *
 * ── DEUX PIÈGES D'URL, MESURÉS PLUTÔT QUE SUPPOSÉS ─────────────────────────
 * 1. `cdn.discordapp.com` signe ses pièces jointes (`?ex=…&is=…&hm=…`) et la
 *    signature vaut moins de 24 h. Un embed qui pointe là est une image cassée
 *    dans l'archive du salon dès le lendemain. `pbs.twimg.com` a le même défaut à
 *    plus longue échéance. On ne sert donc QUE le fichier ré-hébergé chez nous,
 *    et on préfère ne rien montrer plutôt que montrer un carré vide.
 * 2. L'embed exige une URL ABSOLUE. `urlImageAsset()` rend un chemin RELATIF
 *    (`/storage/v1/object/public/assets/…`) parce que nginx sert ce préfixe sur
 *    l'origine du site — parfait pour une balise `<img>`, inutilisable pour
 *    Discord, qui n'a pas d'origine. D'où `imageAbsolue()`.
 */

/** Racine de l'API Discord. La v10 est celle qu'utilisent déjà bot et cron. */
export const API_DISCORD = "https://discord.com/api/v10";

/**
 * Salon de test par défaut, celui des essais de publication du projet.
 *
 * Il n'est PAS dans `discord_channels` (il n'est pas sous veille) : c'est
 * justement pour cela qu'il est nommé ici, en liste blanche explicite, plutôt
 * que découvert. Voir `verifierSalonAnnonce`.
 */
export const SALON_TEST_DEFAUT = "1086617065818947624";

/**
 * Émotes des mascottes, résolues UNE FOIS au chargement du module.
 *
 * `chargeAnnonceTirage` reste ainsi une fonction de ses seuls arguments — un
 * test n'a pas à préparer un environnement pour vérifier une limite de longueur.
 */
const EMOTES = emotesRoseGriffon(process.env);

/** Origine publique du site, sans barre oblique finale. */
export function origine(): string {
  const brut = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || SITE_URL;
  return brut.replace(/\/+$/, "");
}

/**
 * Hôtes dont les URL expirent : on ne les met JAMAIS dans un embed d'archive.
 *
 * `cdn.discordapp.com` et `media.discordapp.net` signent leurs pièces jointes
 * pour moins de 24 h ; `pbs.twimg.com` disparaît avec le compte ou le tweet.
 */
const HOTES_PERISSABLES = new Set(["cdn.discordapp.com", "media.discordapp.net", "pbs.twimg.com"]);

/**
 * URL absolue et durable d'une image, ou `null`.
 *
 * `null` n'est pas un échec : un embed sans image vaut infiniment mieux qu'un
 * embed dont l'image sera cassée dans une semaine, dans un salon que personne ne
 * relira pour le corriger.
 */
export function imageAbsolue(url: string | null, chemin: string | null): string | null {
  const candidat = url && url.trim() !== "" ? url.trim() : urlImageAsset(chemin);
  if (!candidat) {
    return null;
  }
  if (candidat.startsWith("/")) {
    return `${origine()}${candidat}`;
  }
  if (!/^https?:\/\//i.test(candidat)) {
    return null;
  }
  try {
    if (HOTES_PERISSABLES.has(new URL(candidat).hostname.toLowerCase())) {
      return null;
    }
  } catch {
    return null;
  }
  return candidat;
}

/**
 * Rend inertes les mentions contenues dans un texte que NOUS n'écrivons pas.
 *
 * ⚠ CE N'EST PAS UNE PRÉCAUTION THÉORIQUE. Les pseudos affichés viennent des
 * noms de profil X, Discord et Instagram : ils sont entièrement choisis par les
 * participants. Un nom d'affichage `@everyone` recopié tel quel notifierait le
 * serveur entier avec les permissions du bot ; un libellé de lot recopié depuis
 * une légende a le même pouvoir.
 *
 * `allowed_mentions` est la vraie barrière et elle suffit techniquement. Ceci est
 * la seconde couche, et elle sert à autre chose : même neutralisé, un message qui
 * AFFICHE « @everyone » en gras se lit comme un ping et fait ouvrir Discord à
 * cinquante personnes pour rien.
 */
export function neutraliserMentions(texte: string): string {
  return texte
    .replace(/@(everyone|here)\b/gi, "$1")
    .replace(/<@[!&]?(\d+)>/g, "@$1")
    .replace(/<#(\d+)>/g, "#$1");
}

/** « 1er », « 2e », « 3e »… — l'ordinal français, pas l'anglais. */
export function ordinalFr(rang: number): string {
  return rang === 1 ? "1er" : `${rang}e`;
}

/* ── LA CHARGE ────────────────────────────────────────────────────────────── */

/** Un gagnant, tel que l'annonce doit le montrer. */
export interface GagnantAnnonce {
  rang: number;
  pseudo: string;
  /**
   * Le flocon Discord de la personne, ou `null`.
   *
   * ⚠ `null` NE SE REMPLACE PAS. Fabriquer un identifiant pour « avoir une
   * mention partout » pingue un inconnu et attribue publiquement une œuvre à
   * quelqu'un qui ne l'a pas faite. Cinq des quatorze participants d'`iergday`
   * n'existent que sur X ou Instagram : pour eux, l'attribution passe par le
   * pseudo en gras et le lien vers leur publication, ce qui est vérifiable.
   */
  discordId: string | null;
  source: SourceTirage;
  /** Lien public vers la publication qui atteste l'éligibilité. */
  lien: string;
  /** URL ABSOLUE du meilleur fichier de l'œuvre tirée, ou `null`. */
  image: string | null;
  lot: string | null;
}

/** Ce que l'annonce dit du tirage lui-même. */
export interface ContexteAnnonce {
  titreCampagne: string;
  slugCampagne: string;
  numero: number;
  nbParticipants: number;
  nbOeuvres: number;
  nbGagnants: number;
  poidsMode: PoidsMode;
  baliseRound: number;
  baliseChaine: string;
  /** Instant de publication, en ISO — l'horodatage de l'embed. */
  publieLe: string;
}

/** Nombre maximal de boutons-liens : 5 rangées de 5, plafond imposé par Discord. */
const MAX_BOUTONS = BOUTONS_PAR_RANGEE * RANGEES_PAR_MESSAGE;

/**
 * Le message d'annonce, PUR et testé seul.
 *
 * ── POURQUOI LE `content` DOIT SE SUFFIRE ──────────────────────────────────
 * C'est la seule partie que Discord montre en notification, en aperçu de réponse
 * et dans la liste des salons. Un `content` vide avec tout dans l'embed donne une
 * notification qui dit « Rose Griffon a envoyé un message » : le gagnant ne sait
 * pas qu'il a gagné.
 */
export function chargeAnnonceTirage(
  gagnants: readonly GagnantAnnonce[],
  ctx: ContexteAnnonce,
): Record<string, unknown> {
  const classes = gagnants.toSorted((a, b) => a.rang - b.rang);
  const premier = classes[0] ?? null;

  const lignes = classes.map(gagnant => {
    // Une VRAIE mention seulement quand on détient le flocon ; sinon le pseudo en
    // gras. Les deux formes sont neutralisées : le pseudo est du texte que le
    // participant a choisi lui-même.
    const nom = neutraliserMentions(gagnant.pseudo);
    const mention = gagnant.discordId ? `<@${gagnant.discordId}>` : `**${borner(nom, 60)}**`;
    const lot = gagnant.lot ? ` — ${neutraliserMentions(gagnant.lot)}` : "";
    return `**${ordinalFr(gagnant.rang)} ·** ${mention}${lot}`;
  });

  const rappel =
    "Si tu te reconnais et que tu veux être prévenu·e, réponds ici — " +
    "**aucun lot ni tirage n'avait été annoncé pendant la campagne**, " +
    "personne n'a participé en sachant qu'il y en aurait un.";

  const content = borner(
    [
      `${EMOTES.fete} **Tirage au sort — ${neutraliserMentions(ctx.titreCampagne)}** ${EMOTES.annonce}`,
      ...lignes,
      "",
      rappel,
    ].join("\n"),
    LIMITE_CONTENU,
  );

  // ⚠ `parse: []` INTERDIT `@everyone`, `@here` et les rôles, quoi que contienne
  // le texte. La liste blanche `users` est ce qui rend la mention des gagnants
  // réelle sans rien ouvrir d'autre — et quand personne n'a de flocon, le champ
  // est ABSENT, donc aucune mention n'est émise.
  const flocons = [...new Set(classes.map(g => g.discordId).filter((id): id is string => Boolean(id)))];

  const description = borner(
    [
      classes.length === 1 ? `Bravo ${neutraliserMentions(classes[0]?.pseudo ?? "")} !` : "Bravo à toutes et tous !",
      "",
      `${ctx.nbParticipants} participant·es · ${ctx.nbOeuvres} œuvres · ${ctx.nbGagnants} gagnant·e·s`,
      `Poids : ${ctx.poidsMode === "un_par_personne" ? "une chance par personne" : "une chance par œuvre"}`,
      "Chaque œuvre est un ticket, tirés un par un sans remise.",
      `Aléa : drand quicknet, round #${ctx.baliseRound} — personne, nous compris, ne pouvait le prévoir.`,
      `Vérifier : ${origine()}/iergday`,
    ].join("\n"),
    LIMITE_DESCRIPTION,
  );

  // 5 boutons par rangée, 5 rangées : au-delà, Discord refuse le message entier.
  // Les gagnants au-delà du 25e gardent leur ligne dans le `content`, avec leur
  // mention — c'est le bouton qui manque, pas la personne.
  const boutons = classes.slice(0, MAX_BOUTONS).map(gagnant => ({
    label: borner(`Voir la création de ${neutraliserMentions(gagnant.pseudo)}`, LIMITE_LIBELLE_BOUTON),
    style: 5,
    type: 2,
    url: gagnant.lien,
  }));
  const rangees: Array<Record<string, unknown>> = [];
  for (let i = 0; i < boutons.length; i += BOUTONS_PAR_RANGEE) {
    rangees.push({ components: boutons.slice(i, i + BOUTONS_PAR_RANGEE), type: 1 });
  }

  return {
    allowed_mentions: flocons.length > 0 ? { parse: [], users: flocons } : { parse: [] },
    ...(rangees.length > 0 ? { components: rangees } : {}),
    content,
    embeds: [
      {
        ...(premier ? { author: { name: borner(neutraliserMentions(premier.pseudo), LIMITE_AUTEUR) } } : {}),
        color: COULEUR_MARQUE,
        description,
        footer: {
          text: borner(
            `${neutraliserMentions(ctx.titreCampagne)} · ${origine().replace(/^https?:\/\//, "")}/iergday`,
            LIMITE_PIED,
          ),
        },
        ...(premier?.image ? { image: { url: premier.image } } : {}),
        timestamp: ctx.publieLe,
        title: borner(`Tirage n°${ctx.numero}`, LIMITE_TITRE),
        url: `${origine()}/iergday`,
      },
    ],
  };
}
