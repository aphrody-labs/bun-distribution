"use server";

/**
 * Actions d'administration d'une campagne à hashtag.
 *
 * ── LA GARDE EST REFAITE ICI, PAS HÉRITÉE ──────────────────────────────────
 * `app/admin/layout.tsx` protège l'AFFICHAGE des pages. Il ne protège RIEN
 * d'une server action : celle-ci est un point d'entrée HTTP à part entière,
 * appelable sans jamais avoir rendu la page. Chaque fonction ci-dessous
 * commence donc par `exigerAdmin()`.
 *
 * ── ÉCRITURES PAR POOL POSTGRES ────────────────────────────────────────────
 * `getPgPool()` se connecte avec le rôle `rg`, propriétaire des tables : la RLS
 * ne s'applique pas. C'est exactement ce qu'on veut ici (l'admin doit pouvoir
 * dépublier une campagne), et c'est exactement pourquoi la garde ne peut pas
 * être oubliée.
 */

import { z } from "zod";

import { exigerAdmin, revaliderCampagne } from "@/lib/admin-garde";
import { logAdminAction } from "@/lib/admin-logger";
import { getPgPool } from "@/lib/db/pg";

/** Retour uniforme de toutes les actions de cet écran. */
export interface Resultat {
  success: boolean;
  error?: string;
  message?: string;
}

/*
 * `exigerAdmin()` et `revaliderCampagne()` ont été SORTIES de ce fichier le
 * 23/8/2026, vers `@/lib/admin-garde` (`import "server-only"`, PAS `"use
 * server"`). Le tirage au sort a ajouté `actions-tirage.ts` sur le même écran :
 * garder la garde ici l'aurait obligé soit à en recopier une seconde
 * implémentation, soit à l'exporter depuis un fichier `"use server"` — ce qui en
 * ferait un point d'entrée HTTP répondant publiquement « suis-je admin ? ».
 */

// ─── Configuration de la campagne ────────────────────────────────────────────

/**
 * Un hashtag tel que la base l'exige : minuscules, sans croisillon, sans
 * séparateur. La contrainte `CHECK` de `x_campagnes` refuse tout le reste — la
 * normaliser ici évite de renvoyer une erreur Postgres brute à l'écran.
 */
const hashtagNormalise = z
  .string()
  .trim()
  .transform(v => v.replace(/^#+/, "").toLowerCase())
  .refine(v => /^[a-z0-9_]+$/.test(v), "Un hashtag ne peut contenir que des lettres, chiffres et _");

/** Une liste écrite en textarea, une entrée par ligne, lignes vides ignorées. */
const lignes = z
  .string()
  .default("")
  .transform(v =>
    v
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean),
  );

/** Un identifiant de salon Discord : un flocon, ou rien. */
const flocon = z
  .string()
  .trim()
  .transform(v => (v === "" ? null : v))
  .refine(v => v === null || /^\d{15,25}$/.test(v), "Identifiant de salon Discord invalide");

/** Une date-heure de formulaire (`datetime-local`), ou rien. */
const instant = z
  .string()
  .trim()
  .transform(v => (v === "" ? null : v))
  .refine(v => v === null || !Number.isNaN(Date.parse(v)), "Date invalide");

const schemaConfig = z.object({
  slug: z.string().trim().min(1),
  titre: z.string().trim().min(1, "Le titre est obligatoire"),
  surTitre: z.string().trim(),
  description: z.string().trim(),
  noteAffiche: z.string().trim(),
  imageCouverture: z.string().trim(),
  imageAffiche: z.string().trim(),
  imageReglement: z.string().trim(),
  reglement: lignes,
  hashtags: lignes.pipe(z.array(hashtagNormalise).min(1, "Au moins un hashtag")),
  hashtagsAffichage: lignes,
  hashtagsRattrapage: lignes.pipe(z.array(hashtagNormalise)),
  debutLe: instant,
  finLe: instant,
  salonDepot: flocon,
  relaisSalon: flocon,
  relaisDepuis: instant,
  actif: z.boolean(),
  publiee: z.boolean(),
});

export type ConfigCampagne = z.input<typeof schemaConfig>;

/**
 * Enregistre la configuration de la campagne.
 *
 * ⚠ `hashtags_affichage` doit rester ALIGNÉ sur `hashtags` : la contrainte
 * `x_campagnes_affichage_aligne` exige `lower(hashtags_affichage) = hashtags`.
 * On la fait respecter AVANT l'écriture, sinon Postgres renvoie une violation de
 * contrainte que personne ne sait lire depuis un formulaire.
 */
export async function enregistrerCampagne(donnees: ConfigCampagne): Promise<Resultat> {
  const garde = await exigerAdmin();
  if (!garde.ok) return { error: garde.message, success: false };

  const analyse = schemaConfig.safeParse(donnees);
  if (!analyse.success) {
    return { error: analyse.error.issues[0]?.message ?? "Données invalides", success: false };
  }
  const v = analyse.data;

  // L'affichage ne porte QUE la casse. Une entrée qui ne correspond à aucun
  // hashtag déclaré est écartée plutôt que de faire échouer l'enregistrement
  // entier — et une liste vide vaut « afficher les hashtags tels quels ».
  const affichage = v.hashtagsAffichage.filter(h => v.hashtags.includes(h.replace(/^#+/, "").toLowerCase()));
  if (v.hashtagsAffichage.length > 0 && affichage.length !== v.hashtags.length) {
    return {
      error:
        "La casse d'affichage doit couvrir exactement les hashtags déclarés (même liste, même ordre, seule la casse diffère).",
      success: false,
    };
  }

  try {
    const pool = getPgPool();
    await pool.query(
      `update public.x_campagnes set
			   titre = $2, sur_titre = nullif($3,''), description = nullif($4,''),
			   note_affiche = nullif($5,''), image_couverture = nullif($6,''),
			   image_affiche = nullif($7,''), image_reglement = nullif($8,''),
			   reglement = $9::text[], hashtags = $10::text[], hashtags_affichage = $11::text[],
			   hashtags_rattrapage = $12::text[], debut_le = $13::timestamptz, fin_le = $14::timestamptz,
			   salons_depot = $15::text[], relais_salon = $16, relais_depuis = $17::timestamptz,
			   actif = $18, publiee = $19, updated_at = now()
			 where slug = $1`,
      [
        v.slug,
        v.titre,
        v.surTitre,
        v.description,
        v.noteAffiche,
        v.imageCouverture,
        v.imageAffiche,
        v.imageReglement,
        v.reglement,
        v.hashtags,
        affichage,
        v.hashtagsRattrapage,
        v.debutLe,
        v.finLe,
        v.salonDepot ? [v.salonDepot] : [],
        v.relaisSalon,
        v.relaisDepuis,
        v.actif,
        v.publiee,
      ],
    );
    await logAdminAction("update", "x_campagnes", v.slug, { hashtags: v.hashtags, titre: v.titre });
    revaliderCampagne();
    return { message: "Campagne enregistrée.", success: true };
  } catch (err) {
    console.error("[admin/iergday] enregistrerCampagne :", err);
    return { error: messageErreur(err), success: false };
  }
}

// ─── Modération d'une création ───────────────────────────────────────────────

const schemaModeration = z.object({
  slug: z.string().trim().min(1),
  source: z.enum(["x", "discord"]),
  reference: z.string().trim().min(1),
  masque: z.boolean().optional(),
  misEnAvant: z.boolean().optional(),
  motif: z.string().trim().max(500).optional(),
});

export type ModerationCreation = z.input<typeof schemaModeration>;

/**
 * Masque, démasque ou met en avant une création.
 *
 * ⚠ CETTE ÉCRITURE EST LA SEULE À TOUCHER `masque`/`mis_en_avant`. Les récoltes
 * ne les mentionnent JAMAIS dans leurs clauses `do update` — c'est ce qui fait
 * qu'un post retiré le reste à travers toutes les passes suivantes. Ne pas
 * inverser cette responsabilité.
 *
 * Masquer ne supprime PAS le relais déjà parti dans Discord : le message existe,
 * le staff l'a vu. Le retirer d'un salon de suivi effacerait la trace de ce qui
 * a été modéré, ce qui est exactement l'inverse du but.
 */
export async function modererCreation(donnees: ModerationCreation): Promise<Resultat> {
  const garde = await exigerAdmin();
  if (!garde.ok) return { error: garde.message, success: false };

  const analyse = schemaModeration.safeParse(donnees);
  if (!analyse.success) {
    return { error: analyse.error.issues[0]?.message ?? "Données invalides", success: false };
  }
  const v = analyse.data;

  const table = v.source === "x" ? "public.x_campagne_posts" : "public.campagne_creations_discord";
  const colonneCle = v.source === "x" ? "tweet_id" : "message_id";

  try {
    const pool = getPgPool();
    await pool.query(
      `update ${table} set
			   masque = coalesce($3::boolean, masque),
			   motif_masquage = case when $3::boolean is false then null
			                         when $3::boolean is true then nullif($4,'')
			                         else motif_masquage end,
			   mis_en_avant = coalesce($5::boolean, mis_en_avant)
			 where campagne_slug = $1 and ${colonneCle} = $2`,
      [v.slug, v.reference, v.masque ?? null, v.motif ?? "", v.misEnAvant ?? null],
    );
    await logAdminAction("moderate", `campagne:${v.source}`, v.reference, {
      campagne: v.slug,
      masque: v.masque,
      misEnAvant: v.misEnAvant,
    });
    revaliderCampagne();
    return { message: "Modération appliquée.", success: true };
  } catch (err) {
    console.error("[admin/iergday] modererCreation :", err);
    return { error: messageErreur(err), success: false };
  }
}

/**
 * Oublie le relais d'une création : elle repartira à la passe suivante.
 *
 * Sert à deux choses — rejouer un envoi que Discord a refusé, et faire repartir
 * une création qui avait été sautée (masquée depuis démasquée). C'est un
 * `delete` sur la MÉMOIRE du relais, jamais sur la création elle-même.
 */
export async function rejouerRelais(slug: string, source: "x" | "discord", reference: string): Promise<Resultat> {
  const garde = await exigerAdmin();
  if (!garde.ok) return { error: garde.message, success: false };

  try {
    const pool = getPgPool();
    const { rowCount } = await pool.query(
      `delete from public.x_campagne_relais
			  where campagne_slug = $1 and source = $2 and reference_id = $3`,
      [slug, source, reference],
    );
    await logAdminAction("relay-reset", `campagne:${source}`, reference, { campagne: slug });
    revaliderCampagne();
    return {
      message:
        rowCount && rowCount > 0
          ? "Relais oublié : la création repartira à la prochaine passe."
          : "Cette création n'avait pas encore été relayée.",
      success: true,
    };
  } catch (err) {
    console.error("[admin/iergday] rejouerRelais :", err);
    return { error: messageErreur(err), success: false };
  }
}

// ─── Tâches cron ─────────────────────────────────────────────────────────────

/**
 * Les seules tâches déclenchables depuis cet écran.
 *
 * LISTE BLANCHE, et pas le nom de tâche envoyé par le navigateur : le daemon
 * accepte aussi `db`, `crawl` ou `discord:backfill`, qui n'ont rien à faire ici
 * et dont deux tournent pendant des heures. Un écran de campagne ne doit pas
 * pouvoir lancer une réindexation complète du wiki.
 */
export const TACHES_CAMPAGNE = {
  "x:campagnes": "Récolte X — interroge le hashtag et ses variantes fautives",
  "campagnes:discord": "Récolte Discord — rattache les créations du salon de dépôt",
  "campagnes:relais": "Relais — dépose les créations manquantes dans le salon de suivi",
  "discord:messages": "Veille Discord — archive les messages des salons suivis",
  "discord:archives": "Armement — met sous veille les salons de dépôt déclarés",
} as const;

export type TacheCampagne = keyof typeof TACHES_CAMPAGNE;

/** Adresse du daemon `rg-cron` — boucle locale, jamais exposée publiquement. */
function baseCron(): string {
  return (process.env.CRON_URL || "http://127.0.0.1:3005").replace(/\/+$/, "");
}

/**
 * Lance une tâche du daemon `rg-cron`.
 *
 * Le daemon répond **202 immédiatement** et exécute en tâche de fond : cette
 * action confirme le DÉMARRAGE, jamais le résultat. Le dire autrement à l'écran
 * ferait passer un échec silencieux pour un succès — l'issue se lit dans le
 * journal du service et dans les compteurs de la page, au rafraîchissement
 * suivant.
 */
export async function lancerTache(tache: TacheCampagne): Promise<Resultat> {
  const garde = await exigerAdmin();
  if (!garde.ok) return { error: garde.message, success: false };

  if (!Object.hasOwn(TACHES_CAMPAGNE, tache)) {
    return { error: `Tâche « ${tache} » non autorisée depuis cet écran.`, success: false };
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { error: "CRON_SECRET absent : le daemon cron refusera l'appel.", success: false };
  }

  try {
    const reponse = await fetch(`${baseCron()}/tasks/${encodeURIComponent(tache)}/run`, {
      headers: { Authorization: `Bearer ${secret}` },
      method: "POST",
      signal: AbortSignal.timeout(8000),
    });
    if (!reponse.ok) {
      return {
        error: `Le daemon cron a répondu ${reponse.status} : ${(await reponse.text()).slice(0, 160)}`,
        success: false,
      };
    }
    await logAdminAction("cron-run", "cron:task", tache, {});
    return { message: `« ${tache} » démarrée. Le résultat arrive en tâche de fond.`, success: true };
  } catch (err) {
    // Le daemon peut être arrêté : c'est une information utile, pas une erreur
    // à masquer derrière un « échec » générique.
    console.error("[admin/iergday] lancerTache :", err);
    return { error: `Daemon cron injoignable (${messageErreur(err)}).`, success: false };
  }
}

function messageErreur(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
