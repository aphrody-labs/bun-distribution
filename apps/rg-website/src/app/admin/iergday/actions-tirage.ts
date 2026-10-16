"use server";

/**
 * Actions d'administration du TIRAGE AU SORT d'une campagne.
 *
 * ── LA GARDE EST REFAITE ICI, PAS HÉRITÉE ──────────────────────────────────
 * `app/admin/layout.tsx` protège l'AFFICHAGE des pages. Il ne protège RIEN
 * d'une server action : chacune de celles-ci est un point d'entrée HTTP à part
 * entière, atteignable par un POST fabriqué à la main, sans avoir jamais rendu
 * l'écran qui la déclare et sans qu'aucun composant ne l'ait appelée. Toute
 * fonction exportée ci-dessous commence donc par `exigerAdmin()`, sans
 * exception — y compris celles qui ne font que lire. `exigerAdmin` vient de
 * `@/lib/admin-garde` (`import "server-only"`, PAS `"use server"`) : l'exporter
 * d'un fichier `"use server"` en aurait fait un oracle public répondant
 * « suis-je admin ? » à tout porteur de cookie.
 *
 * ── LA GRAINE N'A AUCUN CHEMIN D'ENTRÉE PAR LE FORMULAIRE ──────────────────
 * Aucun schéma de ce fichier ne porte de champ `graine`, `round`, `signature`
 * ni `empreinte`. Ce n'est pas une convention qu'on pourrait oublier : c'est la
 * FORME des schémas, donc rien ne peut être passé en contrebande depuis le
 * navigateur. En mode `balise`, la graine ne vient même pas d'un générateur
 * local — elle est dérivée de la signature d'un round drand POSTÉRIEUR à
 * l'engagement publié, que personne, nous compris, ne peut prévoir. Un tirage à
 * graine locale est une répétition : la base elle-même refuse de le publier
 * (CHECK `x_campagne_tirages_locale_jamais_publique`) et de l'annoncer.
 *
 * ── ÉCRITURES PAR POOL POSTGRES ────────────────────────────────────────────
 * `getPgPool()` se connecte avec le rôle `rg`, PROPRIÉTAIRE des tables : la RLS
 * ne s'applique pas. C'est ce qui permet à l'admin d'arbitrer un roster que
 * personne d'autre ne peut lire — et c'est exactement pourquoi la garde ne peut
 * pas être oubliée une seule fois.
 *
 * ── CE QUE LE JOURNAL D'AUDIT PORTE, ET CE QU'IL NE PORTERA JAMAIS ─────────
 * Chaque écriture appelle `logAdminAction` avec des détails CHOISIS : qui, quoi,
 * combien. Jamais l'objet entier (un roster de quatorze personnes dans une
 * colonne `jsonb` n'est pas une trace, c'est un dépotoir), et JAMAIS la graine
 * d'un tirage non encore publié — la publier dans une table que le staff peut
 * lire vaudrait publication.
 */

import { z } from "zod";

import { exigerAdmin, revaliderCampagne } from "@/lib/admin-garde";
import { logAdminAction } from "@/lib/admin-logger";
import { getPgPool } from "@/lib/db/pg";
import { chargerCampagneAdmin } from "@/lib/x-campagnes/admin";
import {
	chargeAnnonceTirage,
	posterAnnonce,
	rassemblerGagnantsAnnonce,
	SALON_TEST_DEFAUT,
	verifierSalonAnnonce,
} from "@/lib/x-campagnes/annonce-discord";
import type { VerdictVerification } from "@/lib/x-campagnes/tirage";
import {
	annuler,
	bilanRoster,
	chargerTirageComplet,
	creerEngagement,
	DELAI_ROUND_DEFAUT,
	enregistrerAnnonce,
	executerEtEnregistrer,
	marquerPublie,
	type RapportReconstruction,
	reconstruireRoster,
	reserverAnnonce,
	verifierTirageEnregistre,
} from "@/lib/x-campagnes/tirage-queries";

import type { Resultat } from "./actions";

/*
 * `Resultat` est IMPORTÉE EN TYPE depuis `./actions`, jamais appelée : les deux
 * fichiers servent le même écran et `agir()` côté client attend une seule forme
 * de retour. Un `import type` d'un module `"use server"` est effacé à la
 * compilation — aucune référence d'action n'est créée.
 */

/** Un gagnant tel que l'écran l'affiche après un tirage. */
export type GagnantResume = {
	rang: number;
	pseudoAffichage: string;
	oeuvreId: string | null;
	lot: string | null;
};

/*
 * ⚠ `GagnantResume` NE PORTE PAS `cle`. La clé de plateforme
 * (`discord:908269053347504170`, `x:1471410215086170112`) est la moitié du
 * graphe d'identités inter-plateformes que `x_campagne_participants` garde
 * fermé, et le toast qui annonce le résultat n'en a aucun besoin : l'écran
 * relit le tirage complet au rafraîchissement suivant. Une donnée qui ne sert
 * pas à l'affichage ne traverse pas la frontière serveur → client.
 */

function messageErreur(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/* ── SCHÉMAS ──────────────────────────────────────────────────────────────── */

const slugCampagne = z.string().trim().min(1, "Slug de campagne manquant");

/** Un identifiant de tirage : un UUID, jamais autre chose. */
const identifiantTirage = z.string().trim().uuid("Identifiant de tirage invalide");

/**
 * Une clé de participant.
 *
 * ⚠ MÊME EXPRESSION QUE LE CHECK `x_campagne_participants_cle_immuable`, et pour
 * la même raison : une clé est un IDENTIFIANT IMMUABLE, jamais un pseudo.
 * `x:San_La_Vraie` serait refusé par la base — le refuser ici rend le message
 * lisible au lieu d'une violation de contrainte Postgres brute. Le corpus en
 * donne la preuve : un même `author_id` X y porte deux handles historiques
 * (`yukun_0073DQ` puis `yukun073DQ`). Une clé assise sur le pseudo aurait
 * dédoublé cette personne au premier changement de nom.
 */
const cleParticipant = z
	.string()
	.trim()
	.refine(
		(v) => /^((discord|x):\d{6,25}|instagram:[a-z0-9._]{1,30})$/.test(v),
		"Clé de participant invalide : ce doit être un identifiant, jamais un pseudo"
	);

/**
 * Un motif d'arbitrage.
 *
 * Dix caractères, exigés ici ET par la base (`…_motif_si_ineligible`,
 * `…_annule_motive`) : une personne écartée sans motif, c'est une décision
 * cachée dans la donnée, que plus personne ne saura expliquer dans six mois.
 */
const motifObligatoire = z.string().trim().min(10, "Un motif d'au moins 10 caractères est exigé");

/**
 * Une liste saisie à l'écran : soit un champ par rang (tableau), soit un
 * textarea (une entrée par ligne). Les deux formes arrivent, les deux comptent.
 *
 * ⚠ DOUBLON ASSUMÉ ET SIGNALÉ : `actions.ts` porte le même transform, privé.
 * Le remonter demanderait un troisième module partagé pour dix lignes de zod ;
 * il partira dans la passe qui réunira aussi `Chiffre` et `quand()`.
 */
const lignes = z
	.union([z.string(), z.array(z.string())])
	.default("")
	.transform((v) =>
		(typeof v === "string" ? v.split("\n") : v).map((l) => l.trim()).filter(Boolean)
	);

const schemaEngagement = z.object({
	slug: slugCampagne,
	poidsMode: z.enum(["un_par_personne", "par_oeuvre"]),
	nbGagnants: z.coerce.number().int().min(1).max(50),
	lots: lignes,
	graineOrigine: z.enum(["balise", "locale"]),
	delaiRoundSecondes: z.coerce.number().int().min(60).max(3600).default(DELAI_ROUND_DEFAUT),
});

export type FormEngagement = z.input<typeof schemaEngagement>;

const schemaAnnonce = z.object({
	salonId: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v && v !== "" ? v : null))
		.refine((v) => v === null || /^\d{15,25}$/.test(v), "Identifiant de salon Discord invalide"),
	aBlanc: z.coerce.boolean(),
	confirmation: z.string().trim(),
});

export type OptionsAnnonce = z.input<typeof schemaAnnonce>;

/* ── LE ROSTER EST GELÉ DÈS L'ENGAGEMENT ──────────────────────────────────── */

/**
 * L'engagement ouvert d'une campagne, ou `null`.
 *
 * ⚠ TOUTE MODIFICATION DU ROSTER APRÈS ENGAGEMENT INVALIDERAIT
 * `empreinte_participants` — celle-là même qui a été publiée dans Discord avant
 * que le round visé n'existe. Le tirage serait alors refusé par sa propre
 * auto-vérification, ce qui est le bon comportement mais un très mauvais moment
 * pour l'apprendre. Fusionner, écarter ou verrouiller quelqu'un se refuse donc
 * ICI, avec un message qui propose d'annuler l'engagement d'abord.
 */
async function engagementOuvert(slug: string): Promise<{ numero: number; round: string } | null> {
	const { rows } = await getPgPool().query<{ numero: number; balise_round: string | number | null }>(
		`select numero, balise_round from public.x_campagne_tirages
		  where campagne_slug = $1 and graine is null and annule_le is null
		  order by numero desc
		  limit 1`,
		[slug]
	);
	const ouvert = rows[0];
	return ouvert ? { numero: Number(ouvert.numero), round: String(ouvert.balise_round ?? 0) } : null;
}

function refusRosterGele(ouvert: { numero: number; round: string }): Resultat {
	return {
		error:
			`Le roster est gelé : l'engagement du tirage n°${ouvert.numero} (round #${ouvert.round}) est ouvert et ` +
			"son empreinte a été publiée. La modifier maintenant invaliderait la preuve. Tirez ce tirage, ou " +
			"annulez-le avec un motif, puis recommencez.",
		success: false,
	};
}

/* ── ROSTER ───────────────────────────────────────────────────────────────── */

/**
 * Recalcule les compteurs du roster depuis `x_campagne_oeuvres`.
 *
 * `simulation = true` calcule tout et n'écrit rien : c'est le mode par défaut de
 * l'écran, et il doit le rester. Une reconstruction touche les chances de
 * quatorze personnes ; la voir avant de l'appliquer n'est pas un confort.
 *
 * ⚠ ELLE NE CALCULE AUCUNE EMPREINTE D'IMAGE et ne devine JAMAIS une fusion :
 * `sharp` n'est pas chargé dans `website-web`, et deux des quatre fusions réelles
 * d'`iergday` étaient invisibles à toute règle de pseudo. Les créations récoltées
 * depuis le dernier passage du script d'empreintes remontent dans
 * `rapport.creationsSansOeuvre` — et l'engagement les refuse.
 */
export async function reconstruireParticipants(
	slug: string,
	simulation: boolean
): Promise<Resultat & { rapport?: RapportReconstruction }> {
	const garde = await exigerAdmin();
	if (!garde.ok) return { error: garde.message, success: false };

	const analyse = slugCampagne.safeParse(slug);
	if (!analyse.success) {
		return { error: analyse.error.issues[0]?.message ?? "Données invalides", success: false };
	}

	try {
		const rapport = await reconstruireRoster(analyse.data, { simulation });
		await logAdminAction("tirage-roster", "campagne:tirage", analyse.data, {
			anomalies: rapport.anomalies.length,
			creationsBrutes: rapport.creationsBrutes,
			creationsSansOeuvre: rapport.creationsSansOeuvre.length,
			oeuvres: rapport.oeuvres,
			participantsApres: rapport.participantsApres,
			participantsAvant: rapport.participantsAvant,
			simulation,
		});
		if (!simulation) revaliderCampagne();

		const alerte =
			rapport.creationsSansOeuvre.length > 0
				? ` ⚠ ${rapport.creationsSansOeuvre.length} création(s) ne sont rattachées à aucune œuvre : ` +
					"lancez `bun scripts/campagnes/empreintes-oeuvres.ts` avant de tirer, sinon ces dessins n'auront aucun ticket."
				: "";
		return {
			message:
				(simulation
					? `Simulation : ${rapport.participantsAvant} → ${rapport.participantsApres} personne(s), ${rapport.oeuvres} œuvre(s). Rien n'a été écrit.`
					: `Roster reconstruit : ${rapport.participantsApres} personne(s), ${rapport.oeuvres} œuvre(s).`) + alerte,
			rapport,
			success: true,
		};
	} catch (err) {
		console.error("[admin/iergday] reconstruireParticipants :", err);
		return { error: messageErreur(err), success: false };
	}
}

/**
 * Fusionne une identité dans une autre, ou DÉFAIT une fusion.
 *
 * ── CE QUE « FUSIONNER » VEUT DIRE ICI ─────────────────────────────────────
 * Deux lignes de roster désignent la même personne : une seule doit porter les
 * tickets. Les œuvres migrent vers la ligne canonique, l'alias tombe à zéro
 * (CHECK `…_alias_sans_poids`), et le trigger `…_fusion_profondeur_1` interdit
 * toute chaîne A→B→C — donc tout cycle, puisqu'un cycle contient forcément un
 * alias dont la cible est un alias.
 *
 * ── LA FUSION EST RENDUE RÉVERSIBLE, ET ÇA N'ALLAIT PAS DE SOI ─────────────
 * Rien dans `x_campagne_oeuvres` ne dit d'où une œuvre vient : après migration,
 * défaire la fusion aurait laissé une ligne canonique vide et des œuvres
 * définitivement sur l'autre. On écrit donc la liste des œuvres déplacées dans
 * `identifiants.oeuvres_transferees` de l'alias — machine-lisible, et c'est elle
 * que `versCle = null` relit pour les rendre. Sans cette liste, « défaire » eût
 * été un mot pour « abandonner ».
 */
export async function fusionnerParticipant(
	slug: string,
	cle: string,
	versCle: string | null,
	note: string
): Promise<Resultat> {
	const garde = await exigerAdmin();
	if (!garde.ok) return { error: garde.message, success: false };

	const analyse = z
		.object({ cle: cleParticipant, note: z.string().trim().max(2000), slug: slugCampagne, versCle: cleParticipant.nullable() })
		.safeParse({ cle, note, slug, versCle });
	if (!analyse.success) {
		return { error: analyse.error.issues[0]?.message ?? "Données invalides", success: false };
	}
	const v = analyse.data;
	if (v.versCle === v.cle) {
		return { error: "Une ligne ne peut pas être fusionnée dans elle-même.", success: false };
	}

	const client = await getPgPool().connect();
	try {
		const ouvert = await engagementOuvert(v.slug);
		if (ouvert) return refusRosterGele(ouvert);

		await client.query("begin");
		// Même espace de verrou que le tirage : un engagement en cours de création
		// et une fusion sont exactement les deux écritures qui ne doivent pas se
		// croiser. `pg_advisory_xact_lock` est relâché par `commit` COMME par
		// `rollback` — la variante de session fuirait si la connexion repartait au
		// pool en cours d'erreur, et bloquerait tous les tirages suivants.
		await client.query("select pg_advisory_xact_lock($1::int, hashtext($2)::int)", [1_380_271_689, v.slug]);

		const { rows: lignesRoster } = await client.query<LigneRosterMinimale>(
			`select cle, pseudo_affichage, sources, identifiants, fusionne_dans, verrouille, notes,
			        premiere_le, derniere_le
			   from public.x_campagne_participants
			  where campagne_slug = $1 and cle = any($2::text[])
			  for update`,
			[v.slug, v.versCle ? [v.cle, v.versCle] : [v.cle]]
		);
		const alias = lignesRoster.find((l) => l.cle === v.cle);
		if (!alias) {
			throw new Error(`Aucun participant « ${v.cle} » sur la campagne « ${v.slug} ».`);
		}

		let message: string;
		if (v.versCle === null) {
			// ── DÉFAIRE ────────────────────────────────────────────────────
			if (!alias.fusionne_dans) {
				throw new Error(`« ${alias.pseudo_affichage} » n'est pas un alias : il n'y a pas de fusion à défaire.`);
			}
			const cible = alias.fusionne_dans;
			const transferees = oeuvresTransferees(alias.identifiants);
			if (transferees.length > 0) {
				await client.query(
					`update public.x_campagne_oeuvres
					    set cle = $2
					  where campagne_slug = $1 and cle = $3 and oeuvre_id = any($4::text[])`,
					[v.slug, v.cle, cible, transferees]
				);
			}
			const identifiants = { ...objetOuVide(alias.identifiants) };
			delete identifiants.oeuvres_transferees;
			await client.query(
				`update public.x_campagne_participants
				    set fusionne_dans = null, identifiants = $3::jsonb, notes = $4
				  where campagne_slug = $1 and cle = $2`,
				[v.slug, v.cle, identifiants, ajouterNote(alias.notes, `Fusion défaite : ${v.note || "sans commentaire"}`)]
			);
			await recalculerCompteurs(client, v.slug, v.cle);
			await recalculerCompteurs(client, v.slug, cible);
			message =
				transferees.length > 0
					? `Fusion défaite : ${transferees.length} œuvre(s) sont revenues sur « ${alias.pseudo_affichage} ».`
					: `Fusion défaite. Aucune œuvre n'était enregistrée comme transférée : si « ${alias.pseudo_affichage} » ` +
						"devait en récupérer, réaffectez-les à la main puis relancez la reconstruction.";
		} else {
			// ── FUSIONNER ──────────────────────────────────────────────────
			const cible = lignesRoster.find((l) => l.cle === v.versCle);
			if (!cible) {
				throw new Error(`Aucun participant « ${v.versCle} » sur la campagne « ${v.slug} ».`);
			}
			if (cible.fusionne_dans) {
				throw new Error(
					`« ${cible.pseudo_affichage} » est déjà un alias de « ${cible.fusionne_dans} » : une fusion en chaîne ` +
						"est interdite (le trigger de la base la refuserait aussi). Fusionnez vers la ligne canonique."
				);
			}
			if (alias.fusionne_dans) {
				throw new Error(
					`« ${alias.pseudo_affichage} » est déjà fusionné dans « ${alias.fusionne_dans} ». Défaites d'abord ` +
						"cette fusion : deux fusions successives effaceraient la trace de la première."
				);
			}

			const { rows: deplacees } = await client.query<{ oeuvre_id: string }>(
				`update public.x_campagne_oeuvres set cle = $3
				  where campagne_slug = $1 and cle = $2
				 returning oeuvre_id`,
				[v.slug, v.cle, v.versCle]
			);
			const oeuvreIds = deplacees.map((l) => l.oeuvre_id);

			// L'alias garde la mémoire de ce qu'il a cédé — c'est ce qui rend le
			// geste réversible. Ses compteurs tombent à zéro dans la MÊME écriture
			// que `fusionne_dans`, sinon le CHECK `…_alias_sans_poids` refuse.
			await client.query(
				`update public.x_campagne_participants
				    set fusionne_dans = $3, nb_oeuvres = 0, nb_creations_brutes = 0,
				        identifiants = $4::jsonb, notes = $5
				  where campagne_slug = $1 and cle = $2`,
				[
					v.slug,
					v.cle,
					v.versCle,
					{ ...objetOuVide(alias.identifiants), oeuvres_transferees: oeuvreIds },
					ajouterNote(
						alias.notes,
						`Fusionné dans ${v.versCle} (${cible.pseudo_affichage}) : ${v.note || "sans commentaire"}`
					),
				]
			);

			// La cible absorbe sources, dates et identifiants de plateforme. Le
			// dernier point n'est pas cosmétique : `reconstruireRoster` reconnaît une
			// identité absorbée à ces champs, et sans eux elle recréerait un jour une
			// ligne pour l'alias — donc un second ticket au même humain.
			await client.query(
				`update public.x_campagne_participants
				    set sources = $3::text[],
				        premiere_le = least(premiere_le, $4::timestamptz),
				        derniere_le = greatest(derniere_le, $5::timestamptz),
				        identifiants = $6::jsonb
				  where campagne_slug = $1 and cle = $2`,
				[
					v.slug,
					v.versCle,
					[...new Set([...(cible.sources ?? []), ...(alias.sources ?? [])])].toSorted(),
					alias.premiere_le,
					alias.derniere_le,
					absorberIdentifiants(cible.identifiants, alias, v.note),
				]
			);
			await recalculerCompteurs(client, v.slug, v.versCle);
			message =
				`« ${alias.pseudo_affichage} » est désormais un alias de « ${cible.pseudo_affichage} » : ` +
				`${oeuvreIds.length} œuvre(s) transférée(s), un seul ticket pour cette personne.`;
		}

		await client.query("commit");
		await logAdminAction("tirage-fusion", "campagne:participant", v.cle, {
			campagne: v.slug,
			defaite: v.versCle === null,
			verrouille: alias.verrouille,
			versCle: v.versCle,
		});
		revaliderCampagne();
		return { message, success: true };
	} catch (err) {
		await client.query("rollback").catch(() => undefined);
		console.error("[admin/iergday] fusionnerParticipant :", err);
		return { error: messageErreur(err), success: false };
	} finally {
		client.release();
	}
}

/**
 * Écarte ou réintègre une personne, avec un motif écrit.
 *
 * ⚠ C'EST LE SEUL ENDROIT OÙ SE DÉCIDE QUI A UNE CHANCE, et c'est délibérément
 * un interrupteur tracé plutôt qu'une ligne de code. Deux arbitrages ouverts
 * sur `iergday` passent par ici :
 *
 * · INAZO. Tout indique un membre du staff — il a posté le rappel du règlement
 *   dans le salon de dépôt, il relaie les annonces `@rose_griffon` depuis 2023.
 *   Mais `x_campagnes.comptes_organisateurs` ne contient QUE `rose_griffon`, et
 *   écarter quelqu'un sur une impression est exactement ce qu'un dispositif
 *   vérifiable doit rendre impossible. Sa création X est comptée. Si le staff ne
 *   doit pas concourir, la vraie correction est de compléter
 *   `comptes_organisateurs` dans l'onglet Configuration : ce bouton-ci ne fait
 *   qu'une exception nominative, il ne change pas la règle.
 * · LA RÈGLE 1. Le règlement dit « sur Twitter ou Instagram ». Appliqué à la
 *   lettre, il retire toute chance à quatre personnes et fait passer Sanada de
 *   deux œuvres à une. Personne n'a participé en sachant qu'un tirage existerait.
 *
 * Le code ne tranche ni l'un ni l'autre. Il rend l'arbitrage impossible à cacher.
 */
export async function basculerEligibilite(
	slug: string,
	cle: string,
	eligible: boolean,
	motif: string
): Promise<Resultat> {
	const garde = await exigerAdmin();
	if (!garde.ok) return { error: garde.message, success: false };

	const analyse = z
		.object({
			cle: cleParticipant,
			eligible: z.coerce.boolean(),
			motif: z.string().trim().max(500),
			slug: slugCampagne,
		})
		.safeParse({ cle, eligible, motif, slug });
	if (!analyse.success) {
		return { error: analyse.error.issues[0]?.message ?? "Données invalides", success: false };
	}
	const v = analyse.data;

	// Le CHECK `…_motif_si_ineligible` l'exige aussi ; le vérifier ici rend le
	// refus lisible au lieu d'une violation de contrainte Postgres.
	if (!v.eligible && !motifObligatoire.safeParse(v.motif).success) {
		return {
			error:
				"Écarter quelqu'un exige un motif d'au moins 10 caractères. Une personne retirée du tirage sans " +
				"raison écrite, c'est une décision que plus personne ne saura expliquer dans six mois.",
			success: false,
		};
	}

	try {
		const ouvert = await engagementOuvert(v.slug);
		if (ouvert) return refusRosterGele(ouvert);

		const { rows } = await getPgPool().query<{ pseudo_affichage: string; motif_ineligible: string | null }>(
			`update public.x_campagne_participants
			    set eligible = $3, motif_ineligible = case when $3 then null else $4 end
			  where campagne_slug = $1 and cle = $2
			 returning pseudo_affichage, motif_ineligible`,
			[v.slug, v.cle, v.eligible, v.motif]
		);
		const ligne = rows[0];
		if (!ligne) {
			return { error: `Aucun participant « ${v.cle} » sur la campagne « ${v.slug} ».`, success: false };
		}
		await logAdminAction("tirage-eligibilite", "campagne:participant", v.cle, {
			campagne: v.slug,
			eligible: v.eligible,
			motif: v.eligible ? null : v.motif,
		});
		revaliderCampagne();
		return {
			message: v.eligible
				? `« ${ligne.pseudo_affichage} » concourt de nouveau.`
				: `« ${ligne.pseudo_affichage} » est écarté du tirage : ${v.motif}`,
			success: true,
		};
	} catch (err) {
		console.error("[admin/iergday] basculerEligibilite :", err);
		return { error: messageErreur(err), success: false };
	}
}

/**
 * Verrouille une ligne arbitrée à la main.
 *
 * Le verrou ne protège PAS de l'admin — il protège des SCRIPTS : ni la migration
 * d'amorçage ni `reconstruireRoster` ne touchent une ligne verrouillée. C'est ce
 * qui permet de corriger un pseudo ou une fusion sans qu'une reconstruction
 * lancée trois jours plus tard n'efface l'arbitrage sans laisser de trace.
 */
export async function verrouillerParticipant(
	slug: string,
	cle: string,
	verrouille: boolean
): Promise<Resultat> {
	const garde = await exigerAdmin();
	if (!garde.ok) return { error: garde.message, success: false };

	const analyse = z
		.object({ cle: cleParticipant, slug: slugCampagne, verrouille: z.coerce.boolean() })
		.safeParse({ cle, slug, verrouille });
	if (!analyse.success) {
		return { error: analyse.error.issues[0]?.message ?? "Données invalides", success: false };
	}
	const v = analyse.data;

	try {
		const { rows } = await getPgPool().query<{ pseudo_affichage: string }>(
			`update public.x_campagne_participants set verrouille = $3
			  where campagne_slug = $1 and cle = $2
			 returning pseudo_affichage`,
			[v.slug, v.cle, v.verrouille]
		);
		const ligne = rows[0];
		if (!ligne) {
			return { error: `Aucun participant « ${v.cle} » sur la campagne « ${v.slug} ».`, success: false };
		}
		await logAdminAction("tirage-verrou", "campagne:participant", v.cle, {
			campagne: v.slug,
			verrouille: v.verrouille,
		});
		revaliderCampagne();
		return {
			message: v.verrouille
				? `« ${ligne.pseudo_affichage} » est verrouillé : aucune reconstruction ne le touchera.`
				: `« ${ligne.pseudo_affichage} » redevient modifiable par la reconstruction.`,
			success: true,
		};
	} catch (err) {
		console.error("[admin/iergday] verrouillerParticipant :", err);
		return { error: messageErreur(err), success: false };
	}
}

/* ── ENGAGEMENT ───────────────────────────────────────────────────────────── */

/**
 * Ouvre un engagement : gèle le roster, publie les empreintes, vise un round FUTUR.
 *
 * ── L'ORDRE EST TOUTE LA GARANTIE ──────────────────────────────────────────
 * Roster clos → empreintes calculées → PUIS SEULEMENT la graine existe. Inverser
 * deux de ces trois étapes rend le dispositif truquable : publier la graine avant
 * la clôture laisse un participant moudre un identifiant avantageux (huit essais
 * suffisent, c'est mesuré) ; laisser le nombre de gagnants ouvert après le tirage
 * laisse l'organisateur choisir les gagnants sans toucher au tirage. C'est pour
 * cette seconde raison que `nbGagnants` et les lots entrent dans
 * `empreinte_engagement`, et que `effectuerTirage` refuse de tirer si elle ne se
 * recalcule pas à l'identique.
 *
 * Le retour porte `texteEngagement` : le message à coller dans Discord, roster
 * complet en clair. Publier la seule empreinte ne prouverait rien — personne ne
 * peut recalculer un SHA-256 sans les données qui l'ont produit.
 */
export async function engagerTirage(
	donnees: FormEngagement
): Promise<
	Resultat & { tirageId?: string; roundVise?: number; roundPrevuLe?: string; texteEngagement?: string }
> {
	const garde = await exigerAdmin();
	if (!garde.ok) return { error: garde.message, success: false };

	const analyse = schemaEngagement.safeParse(donnees);
	if (!analyse.success) {
		return { error: analyse.error.issues[0]?.message ?? "Données invalides", success: false };
	}
	const v = analyse.data;

	try {
		const engagement = await creerEngagement(
			{
				delaiRoundSecondes: v.delaiRoundSecondes,
				graineOrigine: v.graineOrigine,
				lots: v.lots,
				nbGagnants: v.nbGagnants,
				poidsMode: v.poidsMode,
				slug: v.slug,
			},
			garde.userId
		);

		// Les DEUX empreintes sont journalisées : elles ne révèlent rien (aucune
		// graine n'existe encore) et ce sont elles qu'un tiers opposera au résultat.
		await logAdminAction("tirage-engagement", "campagne:tirage", engagement.tirageId, {
			baliseRound: engagement.baliseRound,
			campagne: v.slug,
			empreinteEngagement: engagement.empreinteEngagement,
			empreinteParticipants: engagement.empreinteParticipants,
			graineOrigine: v.graineOrigine,
			lots: v.lots.length,
			nbGagnants: v.nbGagnants,
			numero: engagement.numero,
			poidsMode: v.poidsMode,
		});
		revaliderCampagne();
		return {
			message:
				v.graineOrigine === "balise"
					? `Tirage n°${engagement.numero} engagé sur le round #${String(engagement.baliseRound)}. ` +
						"Publiez le message d'engagement dans Discord AVANT que le round ne tombe."
					: `Répétition n°${engagement.numero} engagée. Elle ne pourra être ni publiée ni annoncée.`,
			roundPrevuLe: engagement.roundPrevuLe ?? undefined,
			roundVise: engagement.baliseRound ?? undefined,
			success: true,
			texteEngagement: engagement.texteEngagement,
			tirageId: engagement.tirageId,
		};
	} catch (err) {
		console.error("[admin/iergday] engagerTirage :", err);
		return { error: messageErreur(err), success: false };
	}
}

/**
 * Enregistre l'identifiant du message Discord qui porte l'engagement.
 *
 * C'est cet horodatage-là qui rend le tirage opposable : Discord date le message
 * et signale toute édition. Le noter APRÈS le tirage n'aurait aucun sens — on
 * refuse donc dès que la graine existe.
 */
export async function marquerEngagementPublie(tirageId: string, messageId: string): Promise<Resultat> {
	const garde = await exigerAdmin();
	if (!garde.ok) return { error: garde.message, success: false };

	const analyse = z
		.object({
			messageId: z.string().trim().regex(/^\d{15,25}$/, "Identifiant de message Discord invalide"),
			tirageId: identifiantTirage,
		})
		.safeParse({ messageId, tirageId });
	if (!analyse.success) {
		return { error: analyse.error.issues[0]?.message ?? "Données invalides", success: false };
	}
	const v = analyse.data;

	try {
		const { rowCount } = await getPgPool().query(
			`update public.x_campagne_tirages set engagement_message_id = $2
			  where id = $1 and graine is null and annule_le is null`,
			[v.tirageId, v.messageId]
		);
		if (!rowCount) {
			return {
				error:
					"Aucun engagement ouvert sous cet identifiant : le tirage a déjà eu lieu, ou il a été annulé. " +
					"Un message d'engagement publié après le tirage ne prouverait rien.",
				success: false,
			};
		}
		await logAdminAction("tirage-engagement-publie", "campagne:tirage", v.tirageId, {
			messageId: v.messageId,
		});
		revaliderCampagne();
		return { message: "Message d'engagement enregistré. Le compte à rebours court.", success: true };
	} catch (err) {
		console.error("[admin/iergday] marquerEngagementPublie :", err);
		return { error: messageErreur(err), success: false };
	}
}

/* ── TIRER ────────────────────────────────────────────────────────────────── */

/**
 * Exécute le tirage engagé — une fois, et une seule.
 *
 * ── LE DOUBLE-CLIC NE RETIRE JAMAIS ────────────────────────────────────────
 * Tout se joue dans `executerEtEnregistrer`, sous verrou consultatif DE
 * TRANSACTION et `select … for update` sur la ligne : si la graine existe déjà,
 * le résultat existant est rendu tel quel avec `deja: true`, sans qu'une seule
 * ligne ne bouge. Le compare-and-set (`where … and graine is null`) est le filet
 * du dessous, et l'auto-vérification avant `commit` est le dernier : un tirage
 * qui ne se vérifie pas lui-même n'est jamais écrit.
 *
 * ── L'ÉCHEC RÉSEAU N'EST PAS UNE PANNE, C'EST UN REPORT ────────────────────
 * Si drand est injoignable, la transaction est annulée et RIEN n'est écrit. Le
 * tirage se rejoue tel quel : le round visé ne bouge pas et sa signature
 * n'expire jamais. Aucun repli sur une graine locale n'est possible —
 * `graine_origine` est gelée par le trigger d'immuabilité, la base refuserait
 * l'`update`.
 */
export async function effectuerTirage(
	tirageId: string
): Promise<Resultat & { gagnants?: GagnantResume[]; deja?: boolean; verdict?: VerdictVerification }> {
	const garde = await exigerAdmin();
	if (!garde.ok) return { error: garde.message, success: false };

	const analyse = identifiantTirage.safeParse(tirageId);
	if (!analyse.success) {
		return { error: analyse.error.issues[0]?.message ?? "Données invalides", success: false };
	}

	try {
		const resultat = await executerEtEnregistrer(analyse.data, garde.userId);
		const gagnants: GagnantResume[] = resultat.gagnants.map((gagnant) => ({
			lot: gagnant.lot,
			oeuvreId: gagnant.oeuvreId,
			pseudoAffichage: gagnant.pseudoAffichage,
			rang: gagnant.rang,
		}));

		// ⚠ NI LA GRAINE NI SON EMPREINTE NE SONT JOURNALISÉES : le tirage n'est pas
		// encore publié, et l'écrire dans une table que tout le staff peut lire
		// vaudrait publication. Le journal dit QUI a tiré, QUOI, et si le résultat
		// s'est vérifié — pas ce qu'il contient de secret.
		await logAdminAction("tirage-execute", "campagne:tirage", analyse.data, {
			controles: resultat.verdict.controles,
			deja: resultat.deja,
			nbGagnants: gagnants.length,
			numero: resultat.numero,
			rangs: gagnants.map((g) => `${g.rang}·${g.pseudoAffichage}`),
			valide: resultat.verdict.valide,
		});
		revaliderCampagne();

		const nomsGagnants = gagnants.map((g) => g.pseudoAffichage).join(", ");
		return {
			deja: resultat.deja,
			gagnants,
			message: resultat.deja
				? `Ce tirage a déjà eu lieu (n°${resultat.numero}) : ${nomsGagnants}. Rien n'a été retiré.`
				: `Tirage n°${resultat.numero} effectué — ${nomsGagnants}. ` +
					`${resultat.verdict.controles} contrôles concordants. Rien n'est encore public.`,
			success: true,
			verdict: resultat.verdict,
		};
	} catch (err) {
		console.error("[admin/iergday] effectuerTirage :", err);
		return { error: messageErreur(err), success: false };
	}
}

/**
 * Rejoue un tirage écrit et rend son verdict. LECTURE PURE : n'écrit jamais.
 *
 * ⚠ ELLE S'APPELLE `verifierTirageAction` ET NON `verifierTirage`. Le noyau
 * exporte déjà `verifierTirage()` — pure, cliente, sans base — et donner le même
 * nom à un point d'entrée HTTP inviterait tôt ou tard à importer l'un pour
 * l'autre. Un composant client qui croirait vérifier hors ligne enverrait en
 * réalité une requête au serveur, et la vérification indépendante n'en serait
 * plus une.
 *
 * Le verdict porte `controles` : le nombre de contrôles PASSÉS. L'écran doit
 * l'afficher tel quel, jamais un nombre en dur — un tirage valide en rend
 * quinze aujourd'hui, et ce nombre bougera quand un contrôle s'ajoutera.
 */
export async function verifierTirageAction(
	tirageId: string
): Promise<Resultat & { verdict?: VerdictVerification }> {
	const garde = await exigerAdmin();
	if (!garde.ok) return { error: garde.message, success: false };

	const analyse = identifiantTirage.safeParse(tirageId);
	if (!analyse.success) {
		return { error: analyse.error.issues[0]?.message ?? "Données invalides", success: false };
	}

	try {
		const verdict = await verifierTirageEnregistre(analyse.data);
		if (!verdict) {
			return { error: "Ce tirage n'a pas encore eu lieu : il n'y a rien à vérifier.", success: false };
		}
		await logAdminAction("tirage-verifie", "campagne:tirage", analyse.data, {
			anomalies: verdict.anomalies.map((a) => a.code),
			controles: verdict.controles,
			valide: verdict.valide,
		});
		return {
			error: verdict.valide ? undefined : `Vérification EN ÉCHEC : ${verdict.anomalies.map((a) => a.code).join(", ")}.`,
			message: verdict.valide ? `${verdict.controles} contrôles concordants.` : undefined,
			success: verdict.valide,
			verdict,
		};
	} catch (err) {
		console.error("[admin/iergday] verifierTirageAction :", err);
		return { error: messageErreur(err), success: false };
	}
}

/* ── PUBLICATION, ANNONCE, ANNULATION ─────────────────────────────────────── */

/**
 * Publie ou dépublie les gagnants sur `/iergday`.
 *
 * Publier N'ANNONCE RIEN dans Discord : ce sont deux gestes distincts, sur deux
 * boutons distincts. Un tirage à graine locale ne peut pas être publié — c'est
 * un journal de répétition, pas une preuve d'équité : c'est nous qui avons tiré
 * la graine, donc nous aurions pu recommencer jusqu'au résultat voulu (28 884
 * tirages par seconde, 902 essais pour imposer un trio exact). La base le refuse
 * elle-même ; ce message ne fait que le dire en français avant elle.
 */
export async function publierTirage(tirageId: string, publie: boolean): Promise<Resultat> {
	const garde = await exigerAdmin();
	if (!garde.ok) return { error: garde.message, success: false };

	const analyse = z
		.object({ publie: z.coerce.boolean(), tirageId: identifiantTirage })
		.safeParse({ publie, tirageId });
	if (!analyse.success) {
		return { error: analyse.error.issues[0]?.message ?? "Données invalides", success: false };
	}
	const v = analyse.data;

	try {
		await marquerPublie(v.tirageId, v.publie);
		await logAdminAction("tirage-publie", "campagne:tirage", v.tirageId, { publie: v.publie });
		revaliderCampagne();
		return {
			message: v.publie
				? "Gagnants publiés sur /iergday. L'annonce Discord reste un geste séparé."
				: "Gagnants dépubliés : la page n'affiche plus de tirage.",
			success: true,
		};
	} catch (err) {
		console.error("[admin/iergday] publierTirage :", err);
		return { error: messageErreur(err), success: false };
	}
}

/**
 * Annonce le tirage dans le salon PUBLIC de la campagne.
 *
 * ── AUCUNE PUBLICATION PUBLIQUE AUTOMATIQUE : RÈGLE ABSOLUE DU PROJET ──────
 * Cette action n'est appelée NI par `effectuerTirage`, NI par `publierTirage`,
 * ni par un cron, ni par un trigger. Elle exige trois choses qu'aucun réflexe ne
 * produit : un tirage publié et tiré depuis une balise publique, la
 * confirmation du slug tapée à la main (`AlertDialog` seul se clique sans lire),
 * et un mode « à blanc » qui construit la charge, la rend à l'écran et n'écrit
 * rien.
 *
 * ── LE SALON VIENT DE LA CONFIGURATION, JAMAIS DU CODE ─────────────────────
 * `campagne.salonsDepot[0]`. Vérifié en base le 23/8/2026 : `salons_depot`
 * d'`iergday` vaut `{1537458038623965194}` = `🍰〡iergday` (`type = 0`,
 * `suivi = true`). ⚠ À NE PAS CONFONDRE avec `relais_salon`
 * (`1537470522764304435` = `⚙🍰〡iergday-staff`), le fil de suivi de l'équipe :
 * y annoncer le gagnant serait invisible pour la communauté.
 *
 * ── TROIS COUCHES D'IDEMPOTENCE, DU HAUT VERS LE BAS ───────────────────────
 * 1. `reserverAnnonce` lit `annonce_discord_message_id` AVANT tout appel réseau :
 *    le cas normal — l'admin reclique — ne touche jamais Discord.
 * 2. `enregistrerAnnonce` est un compare-and-set ; un `false` signale une double
 *    annonce possible et part en `console.error`, jamais avalé.
 * 3. L'index unique partiel sur `annonce_discord_message_id` empêche deux
 *    tirages de revendiquer le même message.
 * Une double annonce publique est irrattrapable ; un appel évité ne coûte rien.
 */
export async function annoncerTirageDiscord(
	tirageId: string,
	options: OptionsAnnonce
): Promise<Resultat & { messageId?: string; apercu?: string }> {
	const garde = await exigerAdmin();
	if (!garde.ok) return { error: garde.message, success: false };

	const analyseId = identifiantTirage.safeParse(tirageId);
	const analyse = schemaAnnonce.safeParse(options);
	if (!analyseId.success || !analyse.success) {
		const souci = analyseId.success ? analyse : analyseId;
		return { error: souci.error?.issues[0]?.message ?? "Données invalides", success: false };
	}
	const v = analyse.data;

	try {
		const tirage = await chargerTirageComplet(analyseId.data);
		if (!tirage) {
			return { error: "Tirage introuvable.", success: false };
		}
		const campagne = await chargerCampagneAdmin(tirage.campagneSlug);
		if (!campagne) {
			return { error: `Campagne « ${tirage.campagneSlug} » introuvable.`, success: false };
		}

		// La confirmation au clavier vient AVANT tout le reste : c'est le seul geste
		// que l'admin ne peut pas faire par réflexe, et il ne sert à rien de préparer
		// une charge qu'on va refuser.
		if (v.confirmation !== campagne.slug) {
			return {
				error: `Pour confirmer, tapez exactement « ${campagne.slug} » dans le champ de confirmation.`,
				success: false,
			};
		}
		if (!tirage.publie || tirage.annuleLe || tirage.graineOrigine !== "balise" || !tirage.graine) {
			return {
				error:
					"Annonce refusée : seul un tirage PUBLIÉ, non annulé et tiré depuis une balise publique peut être " +
					"annoncé. Un tirage de répétition n'a rien à faire dans un salon public — la base le refuse aussi.",
				success: false,
			};
		}
		if (tirage.gagnants.length === 0) {
			return { error: "Ce tirage n'a aucun gagnant enregistré : il n'y a rien à annoncer.", success: false };
		}

		const salonTest = process.env.RG_SALON_TEST || SALON_TEST_DEFAUT;
		const salonDemande = v.salonId ?? campagne.salonsDepot[0] ?? null;
		if (!salonDemande) {
			return {
				error:
					"Aucun salon de dépôt n'est configuré pour cette campagne : renseignez `salons_depot` dans " +
					"l'onglet Configuration. Le salon d'annonce ne s'écrit jamais en dur dans le code.",
				success: false,
			};
		}
		const salon = await verifierSalonAnnonce(salonDemande, campagne.salonsDepot, salonTest);

		const bilan = await bilanRoster(campagne.slug);
		const gagnants = await rassemblerGagnantsAnnonce(campagne.slug, tirage.gagnants);
		const charge = chargeAnnonceTirage(gagnants, {
			baliseChaine: tirage.balise?.chaine ?? "",
			baliseRound: tirage.balise?.round ?? 0,
			nbGagnants: tirage.nbGagnants,
			nbOeuvres: bilan.oeuvres,
			nbParticipants: tirage.nbParticipants,
			numero: tirage.numero,
			poidsMode: tirage.poidsMode,
			publieLe: tirage.publieLe ?? new Date().toISOString(),
			slugCampagne: campagne.slug,
			titreCampagne: campagne.titre,
		});

		if (v.aBlanc) {
			await logAdminAction("tirage-annonce", "campagne:tirage", analyseId.data, {
				aBlanc: true,
				salon: salon.id,
			});
			return {
				apercu: JSON.stringify(charge, null, 2),
				message: `Essai à blanc : rien n'a été envoyé. Destination prévue : ${salon.nom ?? salon.id}.`,
				success: true,
			};
		}

		// ── Couche 1 : ne jamais toucher le réseau si c'est déjà annoncé ──
		const reservation = await reserverAnnonce(analyseId.data);
		if (!reservation.libre) {
			// Retour en SUCCÈS, et la phrase le dit sans ambiguïté : l'état voulu est
			// atteint. Un bandeau rouge sur un reclic idempotent enverrait le staff
			// chercher une panne qui n'existe pas.
			return {
				message: `Déjà annoncé (message ${String(reservation.messageId)}). Aucun second message n'a été envoyé.`,
				messageId: reservation.messageId ?? undefined,
				success: true,
			};
		}

		const poste = await posterAnnonce(salon.id, charge);

		// ── Couche 2 : compare-and-set ────────────────────────────────────
		const gagne = await enregistrerAnnonce(analyseId.data, salon.id, poste.id);
		if (!gagne) {
			console.error(
				`[admin/iergday] DOUBLE ANNONCE POSSIBLE : le message ${poste.id} a été posté dans ${salon.id} ` +
					`alors que le tirage ${analyseId.data} portait déjà une annonce. Vérifier le salon à la main.`
			);
		}
		await logAdminAction("tirage-annonce", "campagne:tirage", analyseId.data, {
			aBlanc: false,
			enregistre: gagne,
			messageId: poste.id,
			nbGagnants: gagnants.length,
			salon: salon.id,
			salonDeTest: salon.estTest,
		});
		revaliderCampagne();
		return {
			message: `Annonce publiée dans ${salon.nom ?? salon.id} (message ${poste.id}).`,
			messageId: poste.id,
			success: true,
		};
	} catch (err) {
		console.error("[admin/iergday] annoncerTirageDiscord :", err);
		return { error: messageErreur(err), success: false };
	}
}

/**
 * Annule un tirage. JAMAIS un `delete`.
 *
 * Le trigger `x_tirage_suppression_interdite` refuserait la suppression de toute
 * façon, y compris au propriétaire — un `revoke delete` ne vaudrait rien puisque
 * l'app se connecte en `rg`, exempté des droits comme de la RLS. Un tirage
 * abandonné reste donc en base avec son motif, et l'historique de l'écran
 * l'affiche : effacer un tirage, c'est effacer la preuve qu'il a eu lieu.
 */
export async function annulerTirage(tirageId: string, motif: string): Promise<Resultat> {
	const garde = await exigerAdmin();
	if (!garde.ok) return { error: garde.message, success: false };

	const analyse = z
		.object({ motif: motifObligatoire, tirageId: identifiantTirage })
		.safeParse({ motif, tirageId });
	if (!analyse.success) {
		return { error: analyse.error.issues[0]?.message ?? "Données invalides", success: false };
	}
	const v = analyse.data;

	try {
		await annuler(v.tirageId, v.motif);
		await logAdminAction("tirage-annule", "campagne:tirage", v.tirageId, { motif: v.motif });
		revaliderCampagne();
		return {
			message: "Tirage annulé. Il reste en base avec son motif : l'historique ne se vide jamais.",
			success: true,
		};
	} catch (err) {
		console.error("[admin/iergday] annulerTirage :", err);
		return { error: messageErreur(err), success: false };
	}
}

/* ── OUTILLAGE INTERNE ────────────────────────────────────────────────────── */

interface LigneRosterMinimale {
	cle: string;
	pseudo_affichage: string;
	sources: string[] | null;
	identifiants: unknown;
	fusionne_dans: string | null;
	verrouille: boolean;
	notes: string | null;
	premiere_le: Date | string | null;
	derniere_le: Date | string | null;
}

/** Un `jsonb` lu en base, ramené à un objet sûr — jamais un tableau, jamais `null`. */
function objetOuVide(valeur: unknown): Record<string, unknown> {
	return valeur && typeof valeur === "object" && !Array.isArray(valeur)
		? { ...(valeur as Record<string, unknown>) }
		: {};
}

/** Les œuvres qu'une fusion a déplacées, telles que l'alias les a mémorisées. */
function oeuvresTransferees(identifiants: unknown): string[] {
	const brut = objetOuVide(identifiants).oeuvres_transferees;
	return Array.isArray(brut) ? brut.filter((v): v is string => typeof v === "string") : [];
}

/** Empile une note datée sans jamais écraser les précédentes. */
function ajouterNote(existantes: string | null, ajout: string): string {
	const ligne = `[${new Date().toISOString().slice(0, 10)}] ${ajout}`;
	return existantes && existantes.trim() !== "" ? `${existantes}\n${ligne}` : ligne;
}

/**
 * La cible d'une fusion absorbe les identifiants de plateforme de l'alias.
 *
 * ⚠ CE N'EST PAS DE L'ARCHIVAGE, C'EST UNE GARDE. `reconstruireRoster` reconnaît
 * une identité déjà rattachée à `identifiants.x_id` / `discord_id` /
 * `instagram_pseudo` ; sans cette absorption, une reconstruction ultérieure
 * recréerait une ligne pour l'identité absorbée — et rendrait un second ticket au
 * même humain, exactement ce que la fusion venait d'empêcher.
 */
function absorberIdentifiants(
	cible: unknown,
	alias: LigneRosterMinimale,
	note: string
): Record<string, unknown> {
	const fusionne = objetOuVide(cible);
	const source = objetOuVide(alias.identifiants);
	for (const champ of ["x_id", "discord_id", "instagram_pseudo", "x_handle", "discord_handle"]) {
		if (fusionne[champ] === undefined && typeof source[champ] === "string") {
			fusionne[champ] = source[champ];
		}
	}
	const precedentes = Array.isArray(fusionne.fusions) ? fusionne.fusions : [];
	fusionne.fusions = [
		...precedentes,
		{
			cle: alias.cle,
			identifiants: source,
			le: new Date().toISOString(),
			note: note || null,
			pseudo: alias.pseudo_affichage,
		},
	];
	return fusionne;
}

/**
 * Recalcule les compteurs d'une ligne depuis `x_campagne_oeuvres`, qui fait autorité.
 *
 * `greatest(n, brutes)` garde le CHECK `…_compteurs` (`nb_oeuvres <=
 * nb_creations_brutes`) vrai même si une œuvre a été écrite sans `nb_creations`
 * cohérent : mieux vaut un compteur de créations légèrement haut qu'une écriture
 * refusée au milieu d'une fusion.
 */
async function recalculerCompteurs(
	client: { query: (texte: string, valeurs: unknown[]) => Promise<unknown> },
	slug: string,
	cle: string
): Promise<void> {
	await client.query(
		`update public.x_campagne_participants p
		    set nb_oeuvres = calcul.n,
		        nb_creations_brutes = greatest(calcul.n, calcul.brutes)
		   from (select count(*)::int as n, coalesce(sum(o.nb_creations), 0)::int as brutes
		           from public.x_campagne_oeuvres o
		          where o.campagne_slug = $1 and o.cle = $2) as calcul
		  where p.campagne_slug = $1 and p.cle = $2`,
		[slug, cle]
	);
}
