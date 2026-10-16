"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAchilleaAuth, createAchilleaClient } from "@/lib/achillea";
import type { OrganizationDTO } from "@rosegriffon/achillea-types";

import {
  Building2,
  ArrowLeft,
  Loader2,
  Check,
  X,
  ExternalLink,
  Share2,
  Radio,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";

export default function OrganizationValidationPage({ id }: { id: string }) {
  const orgId = id;
  const router = useRouter();
  useAchilleaAuth();

  const [org, setOrg] = useState<OrganizationDTO | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionRunning, setActionRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Rejection Dialog
  const [rejectDialogOpen, setRejectDialogOpen] = useState<boolean>(false);
  const [rejectReason, setRejectReason] = useState<string>("");

  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([orgId]);
  if ([orgId].some((value, position) => !Object.is(value, requestIdentity1[position]))) {
    setRequestIdentity1([orgId]);
    (() => {
      setLoading(true);
    })();
  }
  useEffect(() => {
    let cancelled = false;

    const client = createAchilleaClient({ credentials: "include" });

    client.organizations
      .get(orgId)
      .then(res => {
        if (cancelled) return;
        if (res.ok && res.value?.data) {
          setOrg(res.value.data);
        } else {
          setError("Organisation introuvable ou déjà traitée.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Erreur de communication avec le serveur.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const handleApprove = async () => {
    setActionRunning(true);
    setError(null);
    const client = createAchilleaClient({ credentials: "include" });
    try {
      const res = await client.organizations.approve(orgId);
      if (res.ok) {
        router.push("/achillea/organizations/validate");
      } else {
        setError(res.detail || "Action non autorisée.");
      }
    } finally {
      setActionRunning(false);
    }
  };

  const handleConfirmReject = async () => {
    setActionRunning(true);
    setError(null);
    const client = createAchilleaClient({ credentials: "include" });
    try {
      const res = await client.organizations.reject(orgId);
      if (res.ok) {
        router.push("/achillea/organizations/validate");
      } else {
        setError(res.detail || "Action non autorisée.");
      }
    } finally {
      setActionRunning(false);
      setRejectDialogOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center space-y-3">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Chargement des données de l'organisation...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <div className="space-y-1 border-b border-border pb-6">
        <Link
          href="/achillea/organizations/validate"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour aux organisations en attente
        </Link>
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Building2 className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Validation d'Organisation</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Vérification de la conformité et arbitrage de la demande de structure esport.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {org && (
        <div className="border border-border bg-card rounded-2xl p-6 md:p-8 space-y-6">
          {/* Header with Logo */}
          <div className="flex items-start gap-4 p-4 rounded-xl bg-background border border-border">
            {org.logo ? (
              <img
                src={org.logo}
                alt={org.name}
                className="w-16 h-16 rounded-xl object-cover bg-muted border border-border shrink-0 shadow-sm"
                onError={e => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-muted border border-border flex items-center justify-center text-muted-foreground text-xs font-bold shrink-0">
                ORG
              </div>
            )}

            <div className="space-y-1 flex-1">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">{org.name}</h2>
                <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-muted text-muted-foreground border border-border">
                  {typeof org.origin === "string"
                    ? org.origin.toUpperCase()
                    : ((org.origin as any)?.name ?? (org.origin as any)?.code ?? "FR")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                {org.description || "Aucune description fournie."}
              </p>
            </div>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-background border border-border">
              <div className="text-muted-foreground">Propriétaire déclarant</div>
              <div className="font-bold text-foreground mt-0.5">
                {typeof org.owner === "string" ? org.owner : (org.owner?.username ?? "Inconnu")}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-background border border-border">
              <div className="text-muted-foreground">Slug officiel</div>
              <div className="font-bold font-mono text-foreground mt-0.5">{org.normalizedName ?? orgId}</div>
            </div>
          </div>

          {/* Social & Broadcast Networks */}
          {((org.socialMedias && org.socialMedias.length > 0) ||
            (org.broadcastMedias && org.broadcastMedias.length > 0)) && (
            <div className="p-4 rounded-xl bg-background border border-border space-y-3">
              <div className="text-xs font-bold text-foreground flex items-center gap-2">
                <Share2 className="w-4 h-4 text-primary" />
                Réseaux & Médias renseignés
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {org.socialMedias?.map((sm, idx) => (
                  <a
                    key={idx}
                    href={sm.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted font-medium transition"
                  >
                    <span>{sm.username}</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </a>
                ))}
                {org.broadcastMedias?.map((bm, idx) => (
                  <a
                    key={`bc-${idx}`}
                    href={bm.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-400 font-medium hover:bg-purple-500/20 transition"
                  >
                    <Radio className="w-3 h-3" />
                    <span>{bm.username}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={() => setRejectDialogOpen(true)}
              disabled={actionRunning}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-destructive/40 text-destructive hover:bg-destructive/10 rounded-xl text-xs font-semibold transition"
            >
              <X className="w-4 h-4" />
              Rejeter la demande
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={actionRunning}
              className="inline-flex items-center gap-1.5 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-sm disabled:opacity-50"
            >
              {actionRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Approuver et valider la structure
            </button>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {rejectDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs">
          <div className="border border-border bg-card rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-destructive font-bold text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>Confirmer le rejet de l'organisation</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Êtes-vous sûr de vouloir rejeter cette demande ? L'organisation ne pourra pas héberger de tournoi ni
              aligner d'équipe officielle.
            </p>

            <div className="space-y-1 text-xs">
              <label
                htmlFor="route--id--organization-validation-client-tsx-1"
                className="font-semibold text-foreground"
              >
                Motif du rejet (facultatif)
              </label>
              <textarea
                id="route--id--organization-validation-client-tsx-1"
                rows={3}
                placeholder="Précisez la raison (logo inapproprié, usurpation, informations erronées)..."
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setRejectDialogOpen(false)}
                className="px-4 py-2 border border-border rounded-xl text-xs font-semibold hover:bg-muted transition"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={actionRunning}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-destructive text-destructive-foreground font-bold text-xs rounded-xl hover:bg-destructive/90 transition shadow-sm disabled:opacity-50"
              >
                {actionRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                Confirmer le refus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
