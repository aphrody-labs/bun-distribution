"use client";

import { useState } from "react";
import Link from "next/link";
import { useAchilleaAuth, createAchilleaClient } from "@/lib/achillea";
import { CastAvailabilityStatus } from "@rosegriffon/achillea-types/enums/cast";
import { Tv, ArrowLeft, ShieldAlert, Loader2, Check } from "lucide-react";

export default function CastAvailabilityPage({ id }: { id: string }) {
  const eventId = id;

  const { user, isAuthenticated, login, isLoading: authLoading } = useAchilleaAuth();
  const [statusValue, setStatusValue] = useState<CastAvailabilityStatus>(
    CastAvailabilityStatus.Available,
  );
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError(null);

    const client = createAchilleaClient({ credentials: "include" });
    try {
      const res = await client.casts.recordAvailability(eventId, {
        status: statusValue,
        notes: note || undefined,
      });

      if (res.ok) {
        setSubmitted(true);
      } else {
        setError(res.detail || "Impossible d'enregistrer la disponibilité.");
      }
    } catch {
      setError("Une erreur inattendue est survenue.");
    } finally {
      setSubmitting(false);
    }
  };

  /*
   * La session arrive par un aller-retour réseau (`GET /auth/me`) : tant qu'il
   * n'a pas répondu, `isAuthenticated` vaut false. Rendre le mur tout de suite
   * annonce « Connexion requise » à un visiteur DÉJÀ connecté, à CHAQUE
   * chargement — c'est ce qui donne l'impression qu'Achilléa refuse l'accès.
   * Les pages d'administration attendaient déjà, celles-ci non.
   */
  if (authLoading) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center text-sm text-muted-foreground">
        Vérification de la session…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto" />
        <h2 className="text-xl font-bold">Connexion requise</h2>
        <p className="text-sm text-muted-foreground">
          Connectez-vous pour renseigner vos créneaux de disponibilité en régie.
        </p>
        <button
          type="button"
          onClick={() => login()}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition shadow-sm text-xs"
        >
          Se connecter
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <div className="space-y-1 border-b border-border pb-6">
        <Link
          href="/achillea/casts"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour aux casters
        </Link>
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Tv className="w-5 h-5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Disponibilité Caster</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Indiquez votre présence et créneaux pour l'évènement de cast sélectionné.
        </p>
      </div>

      {submitted ? (
        <div className="border border-border bg-card rounded-2xl p-8 text-center space-y-4">
          <Check className="w-12 h-12 text-emerald-400 mx-auto" />
          <h2 className="text-xl font-bold">Disponibilité enregistrée !</h2>
          <p className="text-xs text-muted-foreground">
            Votre réponse a bien été prise en compte par le responsable régie.
          </p>
          <Link
            href="/achillea/casts"
            className="inline-flex items-center gap-1 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:bg-primary/90 transition"
          >
            Retour aux casters
          </Link>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="border border-border bg-card rounded-2xl p-6 md:p-8 space-y-6"
        >
          {error && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="route-availability-cast-availability-client-tsx-1"
                className="text-xs font-bold text-foreground"
              >
                Votre statut pour ce cast
              </label>
              <select
                id="route-availability-cast-availability-client-tsx-1"
                value={statusValue}
                onChange={(e) => setStatusValue(e.target.value as CastAvailabilityStatus)}
                className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value={CastAvailabilityStatus.Available}>Disponible (prêt à caster)</option>
                <option value={CastAvailabilityStatus.Unavailable}>Indisponible</option>
                <option value={CastAvailabilityStatus.Maybe}>Incertain / À confirmer</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="route-availability-cast-availability-client-tsx-2"
                className="text-xs font-bold text-foreground"
              >
                Commentaire ou précisions d'horaires
              </label>
              <textarea
                id="route-availability-cast-availability-client-tsx-2"
                rows={3}
                placeholder="Ex: Dispo à partir de 15h30, préférence pour le stream secondaire..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition shadow-sm"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Valider ma disponibilité
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
