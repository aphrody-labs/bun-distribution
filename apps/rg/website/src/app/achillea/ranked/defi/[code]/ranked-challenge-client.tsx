"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAchilleaAuth, createAchilleaClient } from "@/lib/achillea";
import { UserAvatar } from "@/components/achillea/UserAvatar";
import { type RankedChallengePreview, MatchMode } from "@rosegriffon/achillea-types";
import { rankedMatchPath, roomIdFromReservation } from "@/lib/achillea/ranked-room";
import { Swords, ShieldAlert, Loader2, Check, X, ArrowLeft } from "lucide-react";

export default function RankedChallengePage({ code }: { code: string }) {
  const rawCode = (code || "").toUpperCase();

  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, login } = useAchilleaAuth();

  const [preview, setPreview] = useState<RankedChallengePreview | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [accepting, setAccepting] = useState<boolean>(false);

  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([
    rawCode,
    isAuthenticated,
  ]);
  if (
    [rawCode, isAuthenticated].some(
      (value, position) => !Object.is(value, requestIdentity1[position]),
    )
  ) {
    setRequestIdentity1([rawCode, isAuthenticated]);
    (() => {
      if (!isAuthenticated) {
        setLoading(false);
        return;
      }
      setLoading(true);
    })();
  }
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    const client = createAchilleaClient();

    client.ranked
      .getChallenge(rawCode)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.value) {
          setPreview(res.value);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rawCode, isAuthenticated]);

  const handleAccept = async () => {
    setAccepting(true);
    const client = createAchilleaClient();
    try {
      const res = await client.ranked.acceptChallenge(rawCode);
      if (res.ok) {
        const roomId = roomIdFromReservation(res.value.reservation);
        if (!roomId) {
          setNotFound(true);
          return;
        }
        try {
          window.localStorage.setItem("achillea:ranked:salle", roomId);
        } catch {
          // Le query param suffit pour rejoindre la salle dans cet onglet.
        }
        router.push(rankedMatchPath(roomId));
      } else {
        setNotFound(true);
      }
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = () => {
    router.push("/achillea/ranked");
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <div className="space-y-6">
        <Link
          href="/achillea/ranked"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour au hub classé
        </Link>

        <div className="border border-border bg-card rounded-2xl p-8 shadow-sm text-center space-y-6">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
            <Swords className="w-7 h-7" />
          </div>

          {/*
           * `isLoading` avant `!isAuthenticated` : sinon le destinataire du
           * défi, déjà connecté, voit d'abord « Connexion requise ».
           */}
          {authLoading ? (
            <div className="py-8 text-xs text-muted-foreground">Vérification de la session…</div>
          ) : !isAuthenticated ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-xl font-bold">Connexion requise pour accepter ce défi</h2>
                <p className="text-xs text-muted-foreground">
                  Vous avez reçu une invitation de duel pour le code{" "}
                  <span className="font-mono font-bold text-foreground">{rawCode}</span>.
                  Connectez-vous avec Discord pour continuer.
                </p>
              </div>
              <button
                type="button"
                onClick={() => login()}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition shadow-sm text-xs"
              >
                Se connecter avec Discord
              </button>
            </div>
          ) : loading ? (
            <div className="py-8 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Vérification de l'invitation...</p>
            </div>
          ) : notFound || !preview ? (
            <div className="space-y-4 py-4">
              <ShieldAlert className="w-10 h-10 text-rose-400 mx-auto opacity-80" />
              <div className="space-y-1">
                <h2 className="text-lg font-bold">Défi introuvable ou expiré</h2>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Ce lien de défi n'existe plus ou a déjà été complété par un autre joueur.
                </p>
              </div>
              <Link
                href="/achillea/ranked"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-secondary text-secondary-foreground text-xs font-semibold rounded-lg hover:bg-secondary/80 transition"
              >
                Retourner au hub classé
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                  Invitation de duel
                </span>
                <h2 className="text-2xl font-black tracking-tight">Défi direct reçu !</h2>
              </div>

              {/* Challenger card */}
              <div className="p-4 rounded-xl bg-background/80 border border-border flex items-center gap-4 text-left">
                <UserAvatar
                  avatar={preview.fromAvatar}
                  displayName={preview.fromDisplayName}
                  className="w-12 h-12"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{preview.fromDisplayName}</div>
                  <div className="text-xs text-amber-400 font-mono font-semibold">
                    {preview.fromElo} AP
                  </div>
                </div>
                <div className="text-right">
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20">
                    {preview.mode === MatchMode.ONE_VS_ONE ? "1v1" : "2v2"}
                  </span>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {preview.ranked ? "Classé" : "Amical"}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={accepting}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition shadow-sm"
                >
                  {accepting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Accepter le match
                </button>
                <button
                  type="button"
                  onClick={handleDecline}
                  className="inline-flex items-center gap-2 px-4 py-2.5 border border-border bg-card hover:bg-muted text-xs font-semibold rounded-xl transition"
                >
                  <X className="w-4 h-4" />
                  Décliner
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
