"use client";

import { InstagramIcon } from "@rosegriffon/ui";
import { useRef, useState, useTransition } from "react";

import { deposerCreationInstagram } from "./actions";

/**
 * DÉPOSER UNE CRÉATION INSTAGRAM.
 *
 * ── POURQUOI CE FORMULAIRE EXISTE ──────────────────────────────────────────
 * X et Discord sont récoltés tout seuls. Instagram ne peut pas l'être : toutes
 * les portes sont fermées à un client non connecté, et l'API officielle demande
 * une revue Meta de plusieurs semaines (mesures dans `docs/insta.md`). Sans ce
 * formulaire, une création Instagram compte pour la campagne mais n'apparaît
 * nulle part — ce que la page devait dire, et ce qui restait frustrant.
 *
 * Le participant colle son lien et son image. C'est plus fiable qu'un collecteur
 * sur un point : **l'attribution est exacte**, puisque c'est l'auteur qui se
 * nomme — là où l'API officielle, elle, ne rend même pas le pseudo.
 *
 * ── REPLIÉ PAR DÉFAUT ──────────────────────────────────────────────────────
 * C'est la voie MINORITAIRE : la plupart des participants passeront par X ou par
 * Discord, en un clic. Déplier quatre champs devant tout le monde pour la
 * minorité qui en a besoin irait contre le reste de la page. `<details>` fait
 * ça sans une ligne de JavaScript, et fonctionne même sans hydratation.
 */
export function DepotInstagram({ slug }: { slug: string }) {
  const [enCours, demarrer] = useTransition();
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);
  const formulaire = useRef<HTMLFormElement>(null);

  const envoyer = (donnees: FormData) =>
    demarrer(async () => {
      const resultat = await deposerCreationInstagram(donnees);
      setRetour({
        ok: resultat.success,
        texte: resultat.success ? (resultat.message ?? "Création enregistrée.") : (resultat.error ?? "Échec du dépôt."),
      });
      // On ne vide le formulaire QUE sur succès : après un refus, le
      // participant doit retrouver ce qu'il avait saisi pour le corriger,
      // pas tout retaper.
      if (resultat.success) formulaire.current?.reset();
    });

  const champ =
    "w-full rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

  return (
    <details className="rounded-2xl border border-outline-variant/60 bg-surface-container-low">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-bold text-on-surface">
        <InstagramIcon className="size-4 shrink-0 text-primary" aria-hidden />
        Ajouter une création publiée sur Instagram
      </summary>

      <form ref={formulaire} action={envoyer} className="space-y-2 px-3 pb-3">
        <input type="hidden" name="campagne" value={slug} />

        <label className="block space-y-1">
          <span className="text-xs text-on-surface-variant">Lien de ta publication</span>
          <input name="permalien" type="url" required placeholder="https://www.instagram.com/p/…" className={champ} />
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-on-surface-variant">Ton pseudo Instagram</span>
            <input name="pseudo" type="text" placeholder="@ton_pseudo" className={champ} />
          </label>

          <label className="block space-y-1">
            {/* L'image est OBLIGATOIRE, et ce n'est pas un caprice : Instagram
						    ne nous laisse pas la récupérer, et une carte de galerie sans
						    visuel n'a aucun intérêt. */}
            <span className="text-xs text-on-surface-variant">Ton image</span>
            <input
              name="image"
              type="file"
              required
              accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
              className={champ}
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-on-surface-variant">Légende (facultatif)</span>
          <textarea name="legende" rows={2} className={champ} />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={enCours}
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-bold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {enCours ? "Envoi…" : "Ajouter ma création"}
          </button>

          {/* `aria-live` : le retour arrive après un aller-retour serveur, donc
					    hors du flux de lecture. Sans ça, un lecteur d'écran ne l'annonce
					    jamais et le participant ne sait pas si son dépôt a abouti. */}
          <p
            aria-live="polite"
            className={`text-xs ${retour?.ok === false ? "text-error" : "text-on-surface-variant"}`}
          >
            {retour?.texte ?? ""}
          </p>
        </div>
      </form>
    </details>
  );
}
