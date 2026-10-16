"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createAchilleaClient } from "@/lib/achillea";
import { UserAvatar } from "@/components/achillea/UserAvatar";
import type { LicenseVerifyResult } from "@rosegriffon/achillea-types/domain/license";
import { ShieldAlert, ArrowLeft, Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function LicenseVerifyPage({ qr }: { qr: string }) {
  const qrSecret = qr;

  const [result, setResult] = useState<LicenseVerifyResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [unavailable, setUnavailable] = useState(false);
  const [reload, setReload] = useState(0);

  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([qrSecret, reload]);
  if ([qrSecret, reload].some((value, position) => !Object.is(value, requestIdentity1[position]))) {
    setRequestIdentity1([qrSecret, reload]);
    (() => {
      setLoading(true);
      setUnavailable(false);
    })();
  }
  useEffect(() => {
    let cancelled = false;

    const client = createAchilleaClient();

    client.licenses
      .verify(qrSecret)
      .then(res => {
        if (cancelled) return;
        if (res.ok && res.value) {
          setResult(res.value);
        } else {
          setUnavailable(true);
          setResult(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnavailable(true);
          setResult(null);
        }
        // Do not log this failure: the request path contains the QR bearer token.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [qrSecret, reload]);

  return (
    <div className="max-w-md mx-auto px-4 py-16 space-y-6">
      <div className="space-y-1 text-center">
        <Link
          href="/achillea"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Accueil Achilléa
        </Link>
        <h1 className="text-2xl font-black">Vérification de Licence</h1>
        <p className="text-xs text-muted-foreground">
          Contrôle officiel d'authenticité de licence compétiteur Achilléa.
        </p>
      </div>

      {loading ? (
        <div className="py-12 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Vérification de l'empreinte de sécurité...</p>
        </div>
      ) : unavailable ? (
        <div role="alert" className="border border-amber-500/30 bg-amber-500/5 rounded-3xl p-8 text-center space-y-4">
          <ShieldAlert className="w-14 h-14 text-amber-400 mx-auto" />
          <div className="space-y-1">
            <h2 className="text-xl font-bold">Vérification indisponible</h2>
            <p className="text-sm text-muted-foreground">
              Le service n’a pas pu vérifier cette licence. Son statut n’a pas pu être confirmé.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReload(value => value + 1)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90"
          >
            Réessayer
          </button>
        </div>
      ) : !result || !result.valid ? (
        <div className="border border-destructive/30 bg-destructive/5 rounded-3xl p-8 text-center space-y-4">
          <XCircle className="w-14 h-14 text-rose-500 mx-auto" />
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-rose-400">Licence Invalide ou Introuvable</h2>
            <p className="text-xs text-muted-foreground">
              {result?.reason === "expired"
                ? "Cette licence a expiré. Le joueur doit renouveler son adhésion."
                : result?.reason === "revoked"
                  ? "Cette licence a été révoquée par l'arbitrage officiel."
                  : "Ce QR code ne correspond à aucune licence valide sur le réseau Achilléa."}
            </p>
          </div>
        </div>
      ) : (
        <div className="border-2 border-emerald-500/40 bg-gradient-to-b from-emerald-500/10 via-card to-card rounded-3xl p-8 text-center space-y-6 shadow-xl">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 flex items-center justify-center text-emerald-400 mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-1">
            <span className="px-3 py-0.5 rounded-full text-xs font-black bg-emerald-500 text-black uppercase tracking-wider">
              Licence Homologuée
            </span>
            <h2 className="text-2xl font-black pt-2">{result.holder?.displayName}</h2>
            <div className="font-mono text-xs text-muted-foreground font-semibold">N° {result.licenseNumber}</div>
          </div>

          {result.holder && (
            <UserAvatar
              avatar={result.holder.avatar}
              displayName={result.holder.displayName}
              className="w-20 h-20 mx-auto ring-4 ring-emerald-500/30 shadow-lg"
            />
          )}

          <div className="p-4 rounded-xl bg-background/80 border border-border text-xs space-y-2 text-left">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Statut d'éligibilité :</span>
              <span className="font-bold text-emerald-400">Autorisé en compétition</span>
            </div>
            {result.validUntil && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Date limite :</span>
                <span className="font-mono font-medium">{new Date(result.validUntil).toLocaleDateString("fr-FR")}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
