/**
 * Validation et normalisation des membres du staff.
 *
 * Ce module est volontairement PUR : aucun import Next, aucun accès réseau ni
 * base de données. Les actions serveur (`actions.ts`) et le formulaire
 * (`TeamMemberDialog.tsx`) partagent donc exactement les mêmes règles, et
 * `bun test` peut les couvrir sans démarrer l'application.
 */
import { z } from "zod";

import { SITE_URL } from "@/lib/site-url";

import { IDS_EQUIPES, libelleEquipe } from "./teams";

/** Bucket Storage qui héberge les photos du staff. */
export const BUCKET_IMAGES = "assets";

/** Préfixe des objets Storage réservés au staff. */
export const DOSSIER_IMAGES = "team-members";

/** Poids maximal accepté pour une photo de membre (4 Mio). */
export const TAILLE_MAX_IMAGE = 4 * 1024 * 1024;

/** Types MIME acceptés à l'envoi, et extension normalisée associée. */
export const EXTENSIONS_PAR_TYPE: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const TYPES_IMAGE_ACCEPTES = Object.keys(EXTENSIONS_PAR_TYPE);

/** Valeur écrite dans `source` pour les membres créés depuis l'administration. */
export const SOURCE_ADMIN = "admin";

/** Valeur écrite par la synchronisation Discord — ces membres restent à valider. */
export const SOURCE_DISCORD = "discord-sync";

/**
 * Champ texte facultatif : une chaîne vide vaut « efface la valeur », donc NULL.
 *
 * Le formulaire envoyait `undefined` pour les champs vidés ; la sérialisation
 * d'une action serveur retire les clés `undefined`, si bien qu'effacer un lien
 * ou un identifiant Discord ne l'effaçait JAMAIS en base.
 */
function texteFacultatif() {
  return z
    .union([z.string(), z.number(), z.null()])
    .transform(valeur => (valeur === null ? "" : String(valeur).trim()))
    .transform(valeur => (valeur === "" ? null : valeur));
}

const baseOrdre = z
  .union([z.string(), z.number(), z.null()])
  .transform(valeur => (valeur === null ? "" : String(valeur).trim()))
  .transform(valeur => (valeur === "" ? null : Number(valeur)))
  .pipe(
    z.union([
      z.null(),
      z
        .number({ message: "L'ordre doit être un nombre entier." })
        .int("L'ordre doit être un nombre entier.")
        .min(0, "L'ordre ne peut pas être négatif.")
        // `display_index` est un `smallint` en base : au-delà, Postgres refuse.
        .max(32767, "L'ordre doit rester inférieur à 32768."),
    ]),
  );

const baseIdDiscord = texteFacultatif().pipe(
  z.union([z.null(), z.string().regex(/^\d{17,20}$/, "L'identifiant Discord doit être composé de 17 à 20 chiffres.")]),
);

const baseLien = texteFacultatif().pipe(
  z.union([
    z.null(),
    z
      .url({ message: "Le lien doit être une URL complète (https://…)." })
      .max(500, "Le lien est trop long.")
      .refine(
        valeur => valeur.startsWith("https://") || valeur.startsWith("http://"),
        "Le lien doit commencer par http:// ou https://",
      ),
  ]),
);

const baseImage = texteFacultatif().pipe(
  z.union([
    z.null(),
    z
      .string()
      .max(1000, "L'URL de l'image est trop longue.")
      .refine(
        valeur => valeur.startsWith("https://") || valeur.startsWith("http://"),
        "L'URL de l'image doit commencer par http:// ou https://",
      ),
  ]),
);

const baseNom = z
  .string({ message: "Le nom est obligatoire." })
  .trim()
  .min(1, "Le nom est obligatoire.")
  .max(80, "Le nom ne doit pas dépasser 80 caractères.");

const baseRole = z
  .string({ message: "Le rôle est obligatoire." })
  .trim()
  .min(1, "Le rôle est obligatoire.")
  .max(80, "Le rôle ne doit pas dépasser 80 caractères.");

const baseEquipe = z.enum(IDS_EQUIPES, { message: "Sélectionnez une équipe valide." });

/**
 * Schéma complet d'un membre — utilisé à la création.
 *
 * Zod 4 exige un `.default()` (ou `.optional()`) explicite pour tolérer une clé
 * absente : une union contenant `z.undefined()` ne suffit plus, le champ est
 * signalé « expected nonoptional ». Le défaut à `null` conserve la sémantique
 * voulue — champ absent comme champ vidé valent tous deux « NULL ».
 */
export const schemaMembre = z.object({
  discord_user_id: baseIdDiscord.default(null),
  display_index: baseOrdre.default(null),
  image_url: baseImage.default(null),
  is_active: z.boolean().default(true),
  member_link: baseLien.default(null),
  name: baseNom,
  role: baseRole,
  team_id: baseEquipe,
});

/**
 * Charge utile telle qu'elle arrive d'un formulaire — donc non fiable.
 *
 * Volontairement plus lâche que `z.input<typeof schemaMembre>` : les champs
 * numériques transitent en chaîne et `team_id` n'est pas encore contraint à
 * l'énumération. C'est `schemaMembre` qui tranche, côté serveur.
 */
export interface EntreeMembre {
  discord_user_id?: string | number | null;
  display_index?: string | number | null;
  image_url?: string | null;
  is_active?: boolean;
  member_link?: string | null;
  name: string;
  role: string;
  team_id: string;
}

export type MembreValide = z.output<typeof schemaMembre>;

/**
 * Schéma d'une mise à jour partielle.
 *
 * Il ne peut PAS dériver de `schemaMembre.partial()` : les `.default(null)` de
 * la création restent actifs sous l'`optional` posé par `partial()`, si bien
 * qu'un simple basculement d'activation renvoyait aussi
 * `discord_user_id: null`, `member_link: null`… et effaçait ces colonnes à
 * chaque clic. Les champs sont donc redéclarés sans valeur par défaut.
 */
export const schemaMiseAJourMembre = z.object({
  discord_user_id: baseIdDiscord.optional(),
  display_index: baseOrdre.optional(),
  image_url: baseImage.optional(),
  is_active: z.boolean().optional(),
  member_link: baseLien.optional(),
  name: baseNom.optional(),
  role: baseRole.optional(),
  team_id: baseEquipe.optional(),
});

export const schemaIdentifiant = z.uuid({ message: "Identifiant de membre invalide." });

/**
 * Ajoute `team_name` dérivé de `team_id`.
 *
 * La colonne est lue publiquement (page `/profil/[username]`) ; la laisser à la
 * main de l'appelant a produit 30 lignes à NULL et deux libellés concurrents
 * pour `assoteam`. Toute écriture passe donc par cette dérivation.
 */
export function avecNomEquipe<T extends { team_id?: string }>(valeurs: T): T & { team_name?: string } {
  if (!valeurs.team_id) {
    return valeurs;
  }
  return { ...valeurs, team_name: libelleEquipe(valeurs.team_id) };
}

/** Traduit une erreur zod en message unique lisible, en français. */
export function premierMessage(erreur: z.ZodError): string {
  return erreur.issues[0]?.message ?? "Données invalides.";
}

/** Traduit une erreur zod en table `champ → message` pour l'affichage inline. */
export function messagesParChamp(erreur: z.ZodError): Record<string, string> {
  const messages: Record<string, string> = {};
  for (const probleme of erreur.issues) {
    const champ = String(probleme.path[0] ?? "");
    if (champ && !messages[champ]) {
      messages[champ] = probleme.message;
    }
  }
  return messages;
}

/** Résultat de la vérification d'un fichier avant envoi. */
export function validerFichierImage(fichier: {
  name: string;
  size: number;
  type: string;
}): { ok: true } | { ok: false; message: string } {
  if (!(fichier.type in EXTENSIONS_PAR_TYPE)) {
    return {
      message: "Format d'image non supporté : utilisez PNG, JPEG, WebP, AVIF ou GIF.",
      ok: false,
    };
  }
  if (fichier.size <= 0) {
    return { message: "Le fichier est vide.", ok: false };
  }
  if (fichier.size > TAILLE_MAX_IMAGE) {
    return { message: "L'image ne doit pas dépasser 4 Mo.", ok: false };
  }
  return { ok: true };
}

/**
 * Construit un chemin d'objet Storage sûr.
 *
 * L'ancien code faisait `file.name.split(".").pop()` : un fichier sans extension
 * donnait un chemin terminé par son nom entier, et un nom hostile pouvait
 * injecter des séparateurs dans le chemin. L'extension vient désormais du type
 * MIME, jamais du nom fourni par le navigateur.
 */
export function construireCheminImage(typeMime: string, graine: string): string {
  const extension = EXTENSIONS_PAR_TYPE[typeMime] ?? "bin";
  const jeton = graine.replace(/[^a-z0-9]/gi, "").slice(0, 24) || "image";
  return `${DOSSIER_IMAGES}/${jeton}.${extension}`;
}

const ORIGINE_PUBLIQUE_PAR_DEFAUT = SITE_URL;

/** Une origine de boucle locale ou privée n'est jamais joignable par un navigateur. */
function estOrigineJoignable(valeur: string | undefined | null): valeur is string {
  if (!valeur || !valeur.startsWith("http")) {
    return false;
  }
  let hote: string;
  try {
    hote = new URL(valeur).hostname;
  } catch {
    return false;
  }
  if (hote === "localhost" || hote === "0.0.0.0" || hote === "::1" || hote.endsWith(".local")) {
    return false;
  }
  if (hote.startsWith("127.") || hote.startsWith("10.") || hote.startsWith("192.168.")) {
    return false;
  }
  return !/^172\.(1[6-9]|2\d|3[01])\./.test(hote);
}

/**
 * URL publique d'un objet du bucket `assets`.
 *
 * `getPublicUrl()` du client service renvoie l'origine INTERNE
 * (`SUPABASE_INTERNAL_URL`, soit `http://127.0.0.1:8811`) : l'URL enregistrée en
 * base était donc injoignable depuis un navigateur, et absente de
 * `images.remotePatterns`, ce qui faisait planter `next/image`. On reconstruit
 * l'URL sur la première origine réellement publique.
 */
export function construireUrlPubliqueAsset(chemin: string, origines: Array<string | undefined | null> = []): string {
  const origine = origines.find(candidate => estOrigineJoignable(candidate));
  const base = (origine ?? ORIGINE_PUBLIQUE_PAR_DEFAUT).replace(/\/+$/, "");
  const cheminPropre = chemin.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/${BUCKET_IMAGES}/${cheminPropre}`;
}

/** Un membre, réduit aux champs qui pilotent le tri. */
export interface MembreTriable {
  display_index: number | null;
  name: string;
}

/**
 * Tri d'affichage — identique à celui du site public.
 *
 * `src/lib/get-team-members.ts` trie `display_index ASC NULLS LAST, name ASC`.
 * L'administration triait `(display_index ?? 999)` sans départage secondaire :
 * les ex æquo (nombreux depuis la synchronisation Discord) apparaissaient dans
 * un ordre différent de celui du site.
 */
export function comparerMembres(a: MembreTriable, b: MembreTriable): number {
  const indexA = a.display_index ?? Number.POSITIVE_INFINITY;
  const indexB = b.display_index ?? Number.POSITIVE_INFINITY;
  if (indexA !== indexB) {
    return indexA - indexB;
  }
  return a.name.localeCompare(b.name, "fr");
}

/** Tri alphabétique, utilisé par le bouton A-Z de l'administration. */
export function comparerMembresParNom(a: MembreTriable, b: MembreTriable): number {
  return a.name.localeCompare(b.name, "fr");
}
