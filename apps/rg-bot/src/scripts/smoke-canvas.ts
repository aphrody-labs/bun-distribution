/**
 * Rendu de contrôle des cartes du bot.
 *
 * Deux séries :
 *   1. des scénarios synthétiques, toujours disponibles, qui couvrent les cas
 *      limites réels (champs vides, pseudo interminable avec emoji, avatar 404,
 *      liste d'un seul membre, liste de 25) ;
 *   2. les données de production, si la base répond — sinon on saute, le smoke
 *      ne doit pas dépendre d'un service.
 *
 * Sortie : `CANVAS_SMOKE_DIR` (défaut `/tmp/rg-canvas`). Les PNG ne sont jamais
 * écrits dans le dépôt.
 */

import { tempPath } from "@aphrody/paths";
import { resolve } from "node:path";

import type * as ServicesSite from "../services/website";
import {
  type MemberCardData,
  renderChroniqueList,
  renderEventList,
  renderMemberList,
  renderProfileCard,
  renderTeamGrid,
} from "../lib/canvas/cards";

const SORTIE = resolve(Bun.env.CANVAS_SMOKE_DIR ?? tempPath("rg-canvas"));

async function ecrire(nom: string, png: Buffer): Promise<void> {
  const chemin = `${SORTIE}/${nom}.png`;
  // `Bun.write` crée le dossier parent (`createPath` vaut `true` par défaut) :
  // le `mkdirSync` qui suivait la déclaration ne servait à rien.
  await Bun.write(chemin, png);
  console.log(`${nom} octets=${png.length} chemin=${chemin}`);
}

const AVATAR_ROMPU = "https://cdn.discordapp.com/avatars/000000000000000000/inexistant.png";

/** Pseudo volontairement hostile : emoji, hangûl, thaï, mot d'un seul tenant. */
const PSEUDO_EXTREME = "🔥🔥 SuperUtilisateurAvecUnPseudoBeaucoupTropLongQuiNeTientPas 한국어 ไทย 🌸✨";

function membre(index: number): MemberCardData {
  return {
    username: `membre_${index}`,
    display_name: index % 3 === 0 ? `Membre numéro ${index}` : null,
    avatar_url: null,
    roles_count: index % 5,
    joined_at: new Date(2024, index % 12, ((index * 3) % 27) + 1),
  };
}

async function scenariosSynthetiques(): Promise<void> {
  await ecrire(
    "profil-normal",
    await renderProfileCard({
      username: "koltilasko",
      full_name: "Koltilasko",
      avatar_url: null,
      banner_url: null,
      bio: "Fondateur de Rose Griffon, passionné d'Inazuma Eleven depuis la première heure. Je m'occupe surtout du wiki Azalée et des collaborations avec les autres communautés francophones.",
      role: "Président de l'association",
      twitter_handle: "yoyo__goat",
      website: "https://rosegriffon.fr",
      discord_id: "123456789012345678",
    }),
  );

  await ecrire(
    "profil-vide",
    await renderProfileCard({
      username: null,
      full_name: null,
      avatar_url: null,
      banner_url: null,
      bio: null,
      role: null,
      twitter_handle: null,
      website: null,
      discord_id: null,
    }),
  );

  await ecrire(
    "profil-extreme",
    await renderProfileCard({
      username: PSEUDO_EXTREME,
      full_name: PSEUDO_EXTREME,
      avatar_url: AVATAR_ROMPU,
      banner_url: AVATAR_ROMPU,
      bio: `${PSEUDO_EXTREME} ${"MotIndivisibleQuiDoitEtreCoupeAuMilieuSinonIlDeborde".repeat(3)} ${"Une bio très longue qui doit être tronquée proprement au bout de six lignes. ".repeat(8)}`,
      role: "Responsable de la cellule de médiation et des partenariats extérieurs",
      twitter_handle: "@un_handle_vraiment_beaucoup_trop_long_pour_la_carte",
      website: "https://exemple.rosegriffon.fr/un/chemin/vraiment/tres/long/qui/deborde",
      discord_id: "987654321098765432",
    }),
  );

  await ecrire("membres-1", await renderMemberList([membre(1)]));
  await ecrire("membres-25", await renderMemberList(Array.from({ length: 25 }, (_, i) => membre(i + 1))));
  await ecrire(
    "membres-pseudo-extreme",
    await renderMemberList([
      {
        username: "pseudo_extreme",
        display_name: PSEUDO_EXTREME,
        avatar_url: AVATAR_ROMPU,
        roles_count: 12,
        joined_at: "pas-une-date",
      },
      {
        username: "sans_avatar",
        display_name: null,
        avatar_url: null,
        roles_count: 1,
        joined_at: null,
      },
    ]),
  );
  await ecrire("membres-vide", await renderMemberList([]));

  await ecrire(
    "equipe-6",
    await renderTeamGrid(
      [
        { name: "Koltilasko", role: "Président", image_url: null },
        {
          name: PSEUDO_EXTREME,
          role: "Responsable communication et réseaux sociaux",
          image_url: AVATAR_ROMPU,
        },
        { name: "Gaëlle", role: "Trésorière", image_url: null },
        { name: "Roy", role: "", image_url: null },
        { name: "Azalée", role: "Rédactrice en chef du wiki", image_url: null },
        { name: "Achilléa", role: "Compétitif", image_url: null },
      ],
      "Bureau de l'Association",
      "Mandat 2026",
    ),
  );
  await ecrire(
    "equipe-1",
    await renderTeamGrid([{ name: "Koltilasko", role: "Président", image_url: null }], "Bureau"),
  );
  await ecrire("equipe-vide", await renderTeamGrid([], "Équipe Lore", "Filtré : archiviste"));

  await ecrire(
    "evenements",
    await renderEventList([
      {
        title: "Tournoi Achilléa — phase finale",
        description: "Diffusion en direct sur Twitch avec les commentateurs de la communauté.",
        start_time: new Date(2026, 8, 12, 20, 30),
        location: "En ligne · Twitch",
        image_url: null,
      },
      {
        title: PSEUDO_EXTREME,
        description: null,
        start_time: "date-invalide",
        location: "Un lieu au nom interminable qui ne tient pas sur la ligne prévue pour lui",
        image_url: AVATAR_ROMPU,
      },
    ]),
  );
  await ecrire("evenements-vide", await renderEventList([]));

  await ecrire(
    "chroniques",
    await renderChroniqueList([
      {
        title: "Critique communautaire de Inazuma Eleven: Victory Road",
        slug: "critique-communautaire",
        excerpt:
          "Trois mois après la sortie, la communauté francophone dresse un bilan contrasté du dernier opus de Level-5.",
        category: "Analyse",
        views_count: 4213,
        featured_image: null,
        created_at: new Date(2026, 5, 2),
      },
      {
        title: "Sans extrait ni image",
        slug: "sans-extrait",
        excerpt: null,
        category: "Brève",
        views_count: null,
        featured_image: null,
        created_at: null,
      },
    ]),
  );
}

async function scenariosProduction(): Promise<void> {
  let services: typeof ServicesSite;
  try {
    services = await import("../services/website");
  } catch (err) {
    console.log(`production=indisponible raison=${err instanceof Error ? err.message : err}`);
    return;
  }
  try {
    const equipe = await services.getTeam("staff");
    await ecrire("prod-equipe", await renderTeamGrid(equipe, "Staff Rose Griffon"));
    const profil = await services.getProfile("koltilasko");
    if (profil) await ecrire("prod-profil", await renderProfileCard(profil));
    const evenements = await services.nextEvents(5);
    await ecrire("prod-evenements", await renderEventList(evenements));
  } catch (err) {
    console.log(`production=echec raison=${err instanceof Error ? err.message : err}`);
  }
}

const debut = Date.now();
await scenariosSynthetiques();
await scenariosProduction();
console.log(`smoke=ok duree_ms=${Date.now() - debut} sortie=${SORTIE}`);
process.exit(0);
