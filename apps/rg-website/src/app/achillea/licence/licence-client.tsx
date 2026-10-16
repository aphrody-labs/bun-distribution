"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  useAchilleaAuth,
  createAchilleaClient,
  licenseStatusLabel,
  licenseStatusTone,
  badgeVariant,
} from "@/lib/achillea";
import { UserAvatar } from "@/components/achillea/UserAvatar";
import { Badge } from "@rosegriffon/ui";
import type { License } from "@rosegriffon/achillea-types/domain/license";
import {
  IdCard,
  ArrowLeft,
  ShieldAlert,
  Download,
  QrCode,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { signalerException } from "@/lib/achillea/signaler";

export default function LicencePage() {
  const { user, isAuthenticated, login, isLoading: authLoading } = useAchilleaAuth();
  const [license, setLicense] = useState<License | null>(null);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([
    isAuthenticated,
    reload,
  ]);
  if (
    [isAuthenticated, reload].some(
      (value, position) => !Object.is(value, requestIdentity1[position]),
    )
  ) {
    setRequestIdentity1([isAuthenticated, reload]);
    (() => {
      if (!isAuthenticated) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
    })();
  }
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    const client = createAchilleaClient({ credentials: "include" });

    client.licenses
      .mine()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setLoadError("Impossible de charger votre licence. Réessayez dans un instant.");
          return;
        }
        setLicense(res.value.license);
        setVerificationToken(res.value.verificationToken);
      })
      .catch((cause) => {
        if (!cancelled) {
          setLoadError("Impossible de charger votre licence. Réessayez dans un instant.");
        }
        signalerException("licence", cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, reload]);

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
          Connectez-vous pour afficher votre licence compétiteur officielle.
        </p>
        <button
          type="button"
          onClick={() => login("/achillea/licence")}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition shadow-sm text-xs"
        >
          Se connecter
        </button>
      </div>
    );
  }

  const tone = license ? licenseStatusTone(license.status) : "secondary";
  const variant = badgeVariant(tone);
  const label = license ? licenseStatusLabel(license.status) : "Non émise";

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <div className="space-y-1 border-b border-border pb-6">
        <Link
          href="/achillea"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour au hub Achilléa
        </Link>
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
            <IdCard className="w-5 h-5" />
          </span>
          <h1 className="text-3xl font-bold tracking-tight">Licence Compétiteur</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Votre titre officiel d'adhésion pour la participation aux compétitions homologuées
          Achilléa.
        </p>
      </div>

      {loading ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Chargement de votre licence...</p>
        </div>
      ) : loadError ? (
        <div
          role="alert"
          className="border border-destructive/30 bg-destructive/5 rounded-2xl p-8 text-center space-y-4"
        >
          <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
          <h3 className="font-bold text-base">Licence temporairement indisponible</h3>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <button
            type="button"
            onClick={() => setReload((value) => value + 1)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90"
          >
            Réessayer
          </button>
        </div>
      ) : !license ? (
        <div className="border border-dashed border-border rounded-2xl p-12 text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-muted-foreground/60 mx-auto" />
          <h3 className="font-bold text-base">Aucune licence active</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Vous n'avez pas encore de licence joueur émise. Rejoignez un clan ou participez à un
            tournoi pour générer votre numéro de licence.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Official License Badge Card */}
          <div className="border-2 border-border/80 bg-gradient-to-br from-card via-card to-muted/20 rounded-3xl p-6 md:p-8 relative overflow-hidden shadow-xl space-y-6">
            {/* Top Card Header */}
            <div className="flex items-center justify-between border-b border-border/60 pb-4">
              <div className="flex items-center gap-2">
                <span className="font-black tracking-widest text-sm text-primary">ACHILLÉA</span>
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                  Licence E-Sport
                </span>
              </div>
              <Badge variant={variant} className="text-xs">
                {label}
              </Badge>
            </div>

            {/* Identity row */}
            <div className="flex items-center gap-5">
              <UserAvatar
                avatar={user?.avatar}
                name={user?.username || "Joueur"}
                className="w-16 h-16 ring-2 ring-primary shrink-0"
              />
              <div className="space-y-1 min-w-0 flex-1">
                <h2 className="text-xl font-black text-foreground truncate">{user?.username}</h2>
                <div className="font-mono text-xs font-semibold text-primary">
                  N° {license.licenseNumber}
                </div>
              </div>
              <div className="p-2 rounded-xl bg-background border border-border shrink-0 hidden sm:block">
                <QrCode className="w-12 h-12 text-foreground" />
              </div>
            </div>

            {/* Dates & Validity */}
            <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
              <div className="p-3 rounded-xl bg-background/60 border border-border">
                <div className="text-muted-foreground">Date d'émission</div>
                <div className="font-bold mt-0.5">
                  {new Date(license.issuedAt).toLocaleDateString("fr-FR")}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-background/60 border border-border">
                <div className="text-muted-foreground">Valable jusqu'au</div>
                <div className="font-bold mt-0.5">
                  {new Date(license.validUntil).toLocaleDateString("fr-FR")}
                </div>
              </div>
            </div>

            {/* Verification link */}
            <div className="text-center pt-2">
              {verificationToken && (
                <Link
                  prefetch={false}
                  href={`/achillea/licence/verify/${encodeURIComponent(verificationToken)}`}
                  className="text-[11px] text-muted-foreground hover:text-primary transition underline underline-offset-4"
                >
                  Lien de vérification officiel pour les arbitres
                </Link>
              )}
            </div>
          </div>

          {/* Download PDF button */}
          {license.pdfUrl && (
            <div className="flex justify-end">
              <a
                href={license.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 transition shadow-sm"
              >
                <Download className="w-4 h-4" />
                Télécharger ma licence (PDF)
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
