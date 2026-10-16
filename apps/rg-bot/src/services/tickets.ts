/**
 * Tickets — la partie qui touche Discord et la base.
 *
 * Les règles vivent dans `lib/tickets.ts` (module pur, testé). Ici : créer un
 * fil, y faire entrer les bonnes personnes, écrire la ligne, fermer proprement.
 *
 * ── POURQUOI DES FILS PRIVÉS ───────────────────────────────────────────────
 * C'est ce que fait déjà le serveur depuis 2023 (`ticketsbot` — le bouton
 * « View Thread » de chaque carte d'historique pointe vers un fil), et c'est le
 * bon choix : un serveur Discord est plafonné à 500 salons, jamais aux fils.
 * 85 tickets en trois ans en salons auraient déjà mangé un sixième du quota.
 *
 * ── QUI VOIT UN FIL PRIVÉ ──────────────────────────────────────────────────
 * Deux mécanismes, et ils s'ADDITIONNENT :
 *
 *   - la LISTE DES MEMBRES du fil. On y entre par mention : mentionner
 *     quelqu'un l'ajoute — et mentionner un RÔLE ajoute TOUS ses porteurs.
 *     Vérifié en direct le 20/8/2026 sur `ticket-0087` : le message d'accueil
 *     mentionnait `@Modérateurs` et `@Staffs`, le fil comptait 35 membres, dont
 *     les 26 porteurs de `@Staffs`. Le commentaire qui vivait ici affirmait
 *     l'inverse (« mentionner un rôle ne fait que notifier ») ; c'était faux, et
 *     c'est ce qui a ouvert tous les tickets au staff large.
 *     Conséquence : **ne mentionner QUE des rôles habilités**. Une mention n'est
 *     pas une notification, c'est une clé.
 *   - la permission **Gérer les fils** (`ManageThreads`) sur le salon parent,
 *     qui donne la lecture de TOUS les fils privés sans y être membre. Et
 *     « Administrateur » la contient : aucune surcharge de salon n'y peut rien.
 *
 * Conséquence d'exploitation, écrite ici parce qu'elle ne se devine pas : les
 * rôles configurés dans `tickets.rolesStaff` / `rolesDirection` DOIVENT porter
 * « Gérer les fils » sur le salon du panneau, et les AUTRES rôles ne doivent
 * PAS la porter. `diagnostiquerAcces` vérifie les deux sens et le dit, plutôt
 * que de laisser découvrir le trou au premier signalement.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";

/**
 * Salon capable de porter un fil PRIVÉ.
 *
 * Il n'y en a qu'un type, et ce n'est pas une simplification : un salon
 * d'annonces ne porte que des fils d'annonces (publics), un salon de conférence
 * et un fil n'en portent aucun. Élargir ce type ferait passer le type-check et
 * échouer l'API à l'exécution, sur le premier ticket ouvert depuis le mauvais
 * salon.
 */
export type SalonAFils = TextChannel;

/** Ce salon peut-il porter un fil privé ? Garde de type, utilisable côté commandes. */
export function porteDesFils(salon: GuildTextBasedChannel | null): salon is SalonAFils {
  return salon !== null && salon.type === ChannelType.GuildText;
}

import { sql } from "../lib/db";
import {
  categorieTicket,
  fuitesDAcces,
  invitations,
  libelleCategorieTicket,
  nomSalonTicket,
  prochainNumero,
  referenceTicket,
  type CategorieTicket,
  type EtatTicket,
} from "../lib/tickets";
import { fiche, ilYA, leJour, pied } from "../lib/ui";
import { reglagesDe } from "./communaute";

// ─── Lignes ─────────────────────────────────────────────────────────────────

export interface Ticket {
  id: number;
  guildId: string;
  numero: number;
  salonId: string;
  auteurId: string;
  categorie: string;
  sujet: string | null;
  statut: EtatTicket;
  prisPar: string | null;
  fermePar: string | null;
  ouvertLe: Date;
  prisLe: Date | null;
  fermeLe: Date | null;
}

interface LigneTicket {
  id: string | number;
  guild_id: string;
  numero: number;
  salon_id: string;
  auteur_id: string;
  categorie: string;
  sujet: string | null;
  statut: string;
  pris_par: string | null;
  ferme_par: string | null;
  ouvert_le: Date;
  pris_le: Date | null;
  ferme_le: Date | null;
}

function versTicket(ligne: LigneTicket): Ticket {
  return {
    auteurId: ligne.auteur_id,
    categorie: ligne.categorie,
    fermeLe: ligne.ferme_le,
    fermePar: ligne.ferme_par,
    guildId: ligne.guild_id,
    id: Number(ligne.id),
    numero: ligne.numero,
    ouvertLe: ligne.ouvert_le,
    prisLe: ligne.pris_le,
    prisPar: ligne.pris_par,
    salonId: ligne.salon_id,
    statut: ligne.statut as EtatTicket,
    sujet: ligne.sujet,
  };
}

const COLONNES = sql`
	id, guild_id, numero, salon_id, auteur_id, categorie, sujet, statut,
	pris_par, ferme_par, ouvert_le, pris_le, ferme_le
`;

/** Le ticket dont ce salon (ou ce fil) est le support, `null` sinon. */
export async function ticketDuSalon(salonId: string): Promise<Ticket | null> {
  const lignes = await sql<LigneTicket[]>`
		SELECT ${COLONNES} FROM bot_tickets WHERE salon_id = ${salonId} LIMIT 1
	`;
  const ligne = lignes[0];
  return ligne ? versTicket(ligne) : null;
}

/**
 * Un ticket par son numéro lisible — la seule prise sur un ticket dont le fil
 * n'existe plus. Sans elle, `/ticket fermer` (qui se lance DANS le fil) laisse
 * la ligne ouverte à jamais, et son auteur muré par la garde anti-doublon.
 */
export async function ticketParNumero(guildId: string, numero: number): Promise<Ticket | null> {
  const lignes = await sql<LigneTicket[]>`
		SELECT ${COLONNES} FROM bot_tickets
		 WHERE guild_id = ${guildId} AND numero = ${numero} LIMIT 1
	`;
  const ligne = lignes[0];
  return ligne ? versTicket(ligne) : null;
}

/** Les tickets NON FERMÉS d'un membre. C'est la matière de la garde anti-doublon. */
export async function ticketsOuvertsDe(guildId: string, auteurId: string): Promise<Ticket[]> {
  const lignes = await sql<LigneTicket[]>`
		SELECT ${COLONNES} FROM bot_tickets
		 WHERE guild_id = ${guildId} AND auteur_id = ${auteurId} AND statut <> 'ferme'
		 ORDER BY ouvert_le ASC
	`;
  return lignes.map(versTicket);
}

/** Tous les tickets non fermés de la guilde, du plus ancien au plus récent. */
export async function ticketsOuverts(guildId: string, limite = 25): Promise<Ticket[]> {
  const lignes = await sql<LigneTicket[]>`
		SELECT ${COLONNES} FROM bot_tickets
		 WHERE guild_id = ${guildId} AND statut <> 'ferme'
		 ORDER BY ouvert_le ASC
		 LIMIT ${Math.min(50, Math.max(1, Math.floor(limite)))}
	`;
  return lignes.map(versTicket);
}

/** Compte les tickets par état, pour la vue d'exploitation. */
export async function compterTickets(guildId: string): Promise<{ ouvert: number; pris: number; ferme: number }> {
  const lignes = await sql<Array<{ statut: string; total: string }>>`
		SELECT statut, count(*)::text AS total FROM bot_tickets
		 WHERE guild_id = ${guildId} GROUP BY statut
	`;
  const compte = { ferme: 0, ouvert: 0, pris: 0 };
  for (const ligne of lignes) {
    if (ligne.statut === "ouvert" || ligne.statut === "pris" || ligne.statut === "ferme") {
      compte[ligne.statut] = Number(ligne.total) || 0;
    }
  }
  return compte;
}

// ─── Ouverture ──────────────────────────────────────────────────────────────

export interface DemandeOuverture {
  guilde: Guild;
  salonPanneau: SalonAFils;
  auteurId: string;
  categorie: CategorieTicket;
  sujet: string | null;
  rolesStaff: readonly string[];
  rolesDirection: readonly string[];
}

export interface TicketOuvert {
  ticket: Ticket;
  fil: ThreadChannel;
}

/**
 * Ouvre un ticket : un fil privé, sa ligne en base, son message d'accueil.
 *
 * ── L'ORDRE N'EST PAS ARBITRAIRE ───────────────────────────────────────────
 * 1. la LIGNE d'abord, avec son numéro : c'est elle qui porte l'unicité
 *    (`unique (guild_id, numero)`). Deux ouvertures simultanées se disputent la
 *    contrainte, et la perdante réessaie — alors que deux fils créés d'abord
 *    porteraient le même nom sans que rien ne s'en aperçoive.
 * 2. le FIL ensuite, nommé d'après le numéro obtenu.
 * 3. la ligne est MISE À JOUR avec l'identifiant du fil.
 *
 * Si la création du fil échoue, la ligne est supprimée : un ticket sans fil est
 * un ticket que personne ne peut ouvrir ni fermer.
 */
export async function ouvrirTicket(demande: DemandeOuverture): Promise<TicketOuvert> {
  const guildId = demande.guilde.id;

  // Numéro : `max + 1`, jamais en dessous du seuil de reprise (86, cf.
  // `lib/tickets.NUMERO_DEPART`). La contrainte d'unicité tranche en cas de
  // course ; une seule reprise suffit à couvrir deux ouvertures simultanées.
  let ticket: Ticket | null = null;
  let derniereErreur: unknown = null;
  for (let essai = 0; essai < 3 && ticket === null; essai++) {
    const [dernier] = await sql<Array<{ numero: number | null }>>`
			SELECT max(numero) AS numero FROM bot_tickets WHERE guild_id = ${guildId}
		`;
    const numero = prochainNumero(dernier?.numero ?? null);
    try {
      const [ligne] = await sql<LigneTicket[]>`
				INSERT INTO bot_tickets (guild_id, numero, salon_id, auteur_id, categorie, sujet)
				VALUES (${guildId}, ${numero}, '', ${demande.auteurId}, ${demande.categorie.cle},
				        ${demande.sujet})
				RETURNING ${COLONNES}
			`;
      ticket = ligne ? versTicket(ligne) : null;
    } catch (err) {
      derniereErreur = err;
    }
  }
  if (!ticket) {
    throw new Error(
      `Numéro de ticket impossible à réserver après trois tentatives : ${
        derniereErreur instanceof Error ? derniereErreur.message : String(derniereErreur)
      }`,
    );
  }

  let fil: ThreadChannel;
  try {
    fil = await demande.salonPanneau.threads.create({
      // Les fils privés ne s'archivent pas d'eux-mêmes avant une semaine : un
      // ticket laissé sans réponse trois jours ne doit pas disparaître de la
      // liste du staff.
      autoArchiveDuration: 10_080,
      // `invitable: false` : seuls le staff et nous ajoutons du monde. Sans ça,
      // l'auteur d'un signalement peut y faire entrer qui il veut.
      invitable: false,
      name: nomSalonTicket(ticket.numero),
      reason: `Ticket ${referenceTicket(ticket.numero)} — ${demande.categorie.libelle}`,
      type: ChannelType.PrivateThread,
    });
  } catch (err) {
    await sql`DELETE FROM bot_tickets WHERE id = ${ticket.id}`;
    throw err;
  }

  await sql`UPDATE bot_tickets SET salon_id = ${fil.id}, maj_le = NOW() WHERE id = ${ticket.id}`;
  ticket = { ...ticket, salonId: fil.id };

  // Mentionner AJOUTE au fil — l'auteur comme les porteurs des rôles cités.
  // C'est donc `invitations()` qui décide qui lira le ticket : un rôle de trop
  // dans les réglages, et ses membres sont dans le fil pour de bon.
  const aInviter = invitations({
    auteurId: demande.auteurId,
    rolesDirection: demande.rolesDirection,
    pourLaDirection: demande.categorie.pourLaDirection,
    rolesStaff: demande.rolesStaff,
  });
  const mentions = aInviter
    .map(entree => (entree.genre === "membre" ? `<@${entree.id}>` : `<@&${entree.id}>`))
    .join(" ");

  try {
    await fil.members.add(demande.auteurId).catch(() => undefined);
    await fil.send({
      allowedMentions: { parse: ["users", "roles"] },
      content: mentions,
    });
  } catch (err) {
    console.warn(`[tickets] invitation impossible sur ${fil.id} :`, err instanceof Error ? err.message : err);
  }

  return { fil, ticket };
}

// ─── Cycle de vie ───────────────────────────────────────────────────────────

/** Passe un ticket en « pris en charge ». Rend `null` si la ligne a disparu. */
export async function prendreTicket(ticketId: number, staffId: string): Promise<Ticket | null> {
  const lignes = await sql<LigneTicket[]>`
		UPDATE bot_tickets
		   SET statut = 'pris', pris_par = ${staffId}, pris_le = NOW(), maj_le = NOW()
		 WHERE id = ${ticketId} AND statut <> 'ferme'
		RETURNING ${COLONNES}
	`;
  const ligne = lignes[0];
  return ligne ? versTicket(ligne) : null;
}

/** Rend un ticket au pot commun — le staff qui l'avait pris ne peut pas traiter. */
export async function rendreTicket(ticketId: number): Promise<Ticket | null> {
  const lignes = await sql<LigneTicket[]>`
		UPDATE bot_tickets
		   SET statut = 'ouvert', pris_par = NULL, pris_le = NULL, maj_le = NOW()
		 WHERE id = ${ticketId} AND statut = 'pris'
		RETURNING ${COLONNES}
	`;
  const ligne = lignes[0];
  return ligne ? versTicket(ligne) : null;
}

/**
 * Ferme un ticket. Le motif est obligatoire côté appelante (`motifPropre`).
 *
 * Le fil est ARCHIVÉ et VERROUILLÉ, jamais supprimé : la consigne du staff dit
 * « on peut lire les tickets déjà fermés », et c'est ce qui remplace la
 * transcription exportée chez un tiers.
 */
export async function fermerTicket(ticketId: number, staffId: string, motif: string): Promise<Ticket | null> {
  const lignes = await sql<LigneTicket[]>`
		UPDATE bot_tickets
		   SET statut = 'ferme', ferme_par = ${staffId}, ferme_le = NOW(),
		       sujet = COALESCE(sujet, ${motif}), maj_le = NOW()
		 WHERE id = ${ticketId} AND statut <> 'ferme'
		RETURNING ${COLONNES}
	`;
  const ligne = lignes[0];
  return ligne ? versTicket(ligne) : null;
}

/** Archive et verrouille le fil. Ne lève jamais : la ligne est déjà écrite. */
export async function clore(fil: ThreadChannel, raison: string): Promise<void> {
  try {
    await fil.setLocked(true, raison);
    await fil.setArchived(true, raison);
  } catch (err) {
    console.warn(`[tickets] archivage impossible du fil ${fil.id} :`, err instanceof Error ? err.message : err);
  }
}

// ─── Réconciliation ─────────────────────────────────────────────────────────

/** Code d'erreur Discord « Unknown Channel ». Le seul qui prouve une disparition. */
const SALON_INCONNU = 10_003;

/** Motif écrit quand le bot ferme lui-même un ticket dont le fil a disparu. */
export const MOTIF_FIL_DISPARU = "Fil supprimé — ticket clos d'office.";

/**
 * Le fil d'un ticket existe-t-il encore ?
 *
 * `disparu` n'est vrai QUE sur `Unknown Channel` (10003). Une panne réseau, un
 * 500 de l'API ou un droit manquant laissent `disparu` faux : fermer d'office un
 * ticket bien vivant sur une erreur passagère serait pire que le laisser ouvert.
 *
 * Le `force` n'est pas décoratif — un fil supprimé pendant que le bot était
 * arrêté reste en cache tel qu'il était, et la question posée ici est justement
 * celle à laquelle le cache ne sait pas répondre.
 */
async function filDuTicket(guilde: Guild, salonId: string): Promise<{ fil: ThreadChannel | null; disparu: boolean }> {
  try {
    const salon = await guilde.channels.fetch(salonId, { force: true });
    if (!salon) {
      return { disparu: true, fil: null };
    }
    return { disparu: false, fil: salon.isThread() ? salon : null };
  } catch (err) {
    return { disparu: (err as { code?: unknown }).code === SALON_INCONNU, fil: null };
  }
}

/**
 * Ne garde que les tickets dont le fil existe encore, et ferme les autres.
 *
 * ── POURQUOI CE PASSAGE EXISTE ─────────────────────────────────────────────
 * La garde anti-doublon lit la BASE, et un fil supprimé sur Discord n'écrit
 * rien en base. Le 14/8/2026, un ticket de test (`ticket-0086`) a vu son fil
 * supprimé sans être fermé : sa ligne est restée `ouvert`, et son auteur s'est
 * retrouvé incapable d'ouvrir le moindre ticket pendant huit jours — renvoyé
 * par le refus vers un salon qui n'existait plus. Une garde qui protège d'un
 * doublon ne doit pas pouvoir murer quelqu'un.
 *
 * La réconciliation est donc faite AVANT la garde, à chaque ouverture : c'est
 * le seul moment où l'on sait qui interroger, et le coût est d'un appel par
 * ticket non fermé du membre — soit un, en pratique.
 */
export async function reconcilierTicketsOuverts(guilde: Guild, tickets: readonly Ticket[]): Promise<Ticket[]> {
  const vivants: Ticket[] = [];
  for (const ticket of tickets) {
    const { disparu } = await filDuTicket(guilde, ticket.salonId);
    if (!disparu) {
      vivants.push(ticket);
      continue;
    }
    const ferme = await fermerTicket(ticket.id, guilde.client.user?.id ?? ticket.auteurId, MOTIF_FIL_DISPARU).catch(
      (err: unknown) => {
        console.warn(
          `[tickets] fermeture d'office impossible de ${referenceTicket(ticket.numero)} :`,
          err instanceof Error ? err.message : err,
        );
        return null;
      },
    );
    if (ferme) {
      console.warn(`[tickets] ${referenceTicket(ticket.numero)} fermé d'office : fil ${ticket.salonId} supprimé.`);
    } else {
      // La ligne n'a pas pu être fermée : la compter vivante plutôt que de
      // laisser ouvrir un second ticket à chaque tentative.
      vivants.push(ticket);
    }
  }
  return vivants;
}

// ─── Carte d'historique ─────────────────────────────────────────────────────

export interface FermetureAPublier {
  client: Client;
  guildId: string;
  ticket: Ticket;
  motif: string;
  /** Lien du fil archivé, `null` s'il a disparu. */
  urlFil: string | null;
  /** Qui a fermé, quand la ligne ne le porte pas encore. */
  fermePar: string;
}

/**
 * Publie la carte de fermeture dans le salon d'historique.
 *
 * Les champs reprennent EXACTEMENT ceux des 84 cartes déjà présentes
 * (Ticket ID · Opened By · Closed By · Open Time · Claimed By · Reason) : le
 * salon doit rester lisible d'un seul coup d'œil sur trois ans d'archives, pas
 * se scinder en un « avant » et un « après ».
 */
export async function publierFermeture({
  client,
  fermePar,
  guildId,
  motif,
  ticket,
  urlFil,
}: FermetureAPublier): Promise<void> {
  const reglages = await reglagesDe(guildId);
  if (!reglages.tickets.salonHistorique) {
    return;
  }
  const salon = await client.channels.fetch(reglages.tickets.salonHistorique).catch(() => null);
  if (!salon || !salon.isTextBased() || !("send" in salon)) {
    return;
  }

  const carte = fiche({
    icone: "ticket",
    intention: "succes",
    titre: `Ticket ${referenceTicket(ticket.numero)} fermé`,
    url: urlFil,
  });
  carte
    .champ("Catégorie", libelleCategorieTicket(ticket.categorie), { enLigne: true })
    .champ("Ouvert par", `<@${ticket.auteurId}>`, { enLigne: true })
    .champ("Fermé par", `<@${ticket.fermePar ?? fermePar}>`, { enLigne: true })
    .champ("Ouvert le", leJour(ticket.ouvertLe, "f"), { enLigne: true })
    .champ("Pris en charge par", ticket.prisPar ? `<@${ticket.prisPar}>` : "personne", {
      enLigne: true,
    })
    .champ("Durée", ilYA(ticket.ouvertLe), { enLigne: true })
    .champ("Motif", motif);
  if (ticket.sujet) {
    carte.champ("Sujet à l'ouverture", ticket.sujet);
  }

  await salon
    .send({
      embeds: [
        pied(carte.embed, {
          note: urlFil ? "le fil reste lisible, il n'est pas supprimé" : "le fil de ce ticket n'existe plus",
        }),
      ],
    })
    .catch((err: unknown) =>
      console.warn("[tickets] historique non écrit :", err instanceof Error ? err.message : err),
    );
}

// ─── Diagnostic ─────────────────────────────────────────────────────────────

export interface Diagnostic {
  /** Ce qui empêche le système de fonctionner, prêt à afficher. */
  blocages: string[];
  /** Ce qui marchera mais mérite d'être su. */
  avertissements: string[];
}

/**
 * Vérifie que le système PEUT fonctionner, avant qu'un membre ne s'en aperçoive.
 *
 * Trois vérifications que rien d'autre ne fait :
 *   - le BOT peut-il créer un fil privé et y écrire ?
 *   - les rôles de prise en charge portent-ils « Gérer les fils » ? Sans elle,
 *     les tickets existent, sont bien créés, et personne ne les voit. C'est la
 *     panne la plus coûteuse du domaine : elle est silencieuse.
 *   - et l'inverse, qui coûte plus cher encore : QUI D'AUTRE les voit ? La règle
 *     du serveur est « modération et direction, personne d'autre » ; un rôle de
 *     staff large qui garde « Gérer les fils » sur ce salon lit tous les
 *     tickets, signalements compris, sans figurer nulle part dans les réglages.
 *     Cette fuite-là est encore plus silencieuse que la panne : rien ne casse.
 */
export async function diagnostiquerAcces(
  guilde: Guild,
  salonPanneau: GuildTextBasedChannel,
  roles: readonly string[],
): Promise<Diagnostic> {
  const blocages: string[] = [];
  const avertissements: string[] = [];

  const moi = guilde.members.me;
  if (!moi) {
    blocages.push("Le bot n'est pas résolu comme membre de ce serveur.");
    return { avertissements, blocages };
  }
  const miennes = salonPanneau.permissionsFor(moi);
  if (!miennes?.has(PermissionFlagsBits.CreatePrivateThreads)) {
    blocages.push(
      `Le bot n'a pas « Créer des fils privés » sur ${salonPanneau.toString()} : aucun ticket ne peut être ouvert.`,
    );
  }
  if (!miennes?.has(PermissionFlagsBits.SendMessagesInThreads)) {
    blocages.push(
      `Le bot n'a pas « Envoyer des messages dans les fils » sur ${salonPanneau.toString()} : le ticket serait créé puis muet.`,
    );
  }
  if (!miennes?.has(PermissionFlagsBits.ManageThreads)) {
    avertissements.push(
      `Le bot n'a pas « Gérer les fils » sur ${salonPanneau.toString()} : il ne pourra pas archiver un ticket à la fermeture.`,
    );
  }

  for (const roleId of roles) {
    const role = guilde.roles.cache.get(roleId) ?? (await guilde.roles.fetch(roleId).catch(() => null));
    if (!role) {
      avertissements.push(`Le rôle \`${roleId}\` n'existe plus sur ce serveur.`);
      continue;
    }
    const siennes = salonPanneau.permissionsFor(role);
    if (!siennes?.has(PermissionFlagsBits.ManageThreads)) {
      blocages.push(
        `${role.toString()} n'a pas « Gérer les fils » sur ${salonPanneau.toString()} : ses membres ne VERRONT PAS les tickets. ` +
          "Un fil privé n'est visible que de ses invités et des porteurs de cette permission.",
      );
    }
  }

  // ── Et tous les AUTRES rôles du serveur ────────────────────────────────
  // `@everyone` est gardé dans l'observation — « tout le serveur lit les
  // tickets » est précisément le cas qu'il ne faut pas manquer. La règle, elle,
  // vit dans `lib/tickets.fuitesDAcces` (pure, testée) ; ici on ne fait que
  // mesurer la permission RÉELLE sur le salon, surcharges comprises.
  const tousLesRoles = await guilde.roles.fetch().catch(() => guilde.roles.cache);
  // Les porteurs ne sont comptés que si la liste des membres est vraiment en
  // cache (le bot la charge au démarrage) : un cache vide ferait passer TOUS
  // les rôles pour inhabités, et la vérification pour muette.
  const membresConnus = guilde.members.cache.size > 1;
  const observes = tousLesRoles.map(role => ({
    administrateur: role.permissions.has(PermissionFlagsBits.Administrator),
    gereLesFils: salonPanneau.permissionsFor(role)?.has(PermissionFlagsBits.ManageThreads) ?? false,
    id: role.id,
    integration: role.managed,
    nom: role.toString(),
    porteursHumains: membresConnus ? role.members.filter(m => !m.user.bot).size : null,
  }));
  const fuites = fuitesDAcces([...observes.values()], roles, salonPanneau.toString());
  avertissements.push(...fuites.avertissements);

  return { avertissements, blocages };
}

/** Résout la catégorie d'un ticket en base, `null` si elle a disparu du code. */
export function categorieDe(ticket: Ticket): CategorieTicket | null {
  return categorieTicket(ticket.categorie);
}
