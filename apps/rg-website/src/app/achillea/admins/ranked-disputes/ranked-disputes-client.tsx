"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAchilleaAuth, createAchilleaClient } from "@/lib/achillea";
import type { RankedAdminDispute } from "@rosegriffon/achillea-types/domain/ranked";
import {
  Card,
  CardHeader,
  CardContent,
  Button,
  Badge,
  Skeleton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rosegriffon/ui";
import { Gavel, ArrowLeft, RefreshCw, Loader2, CheckCircle2, AlertTriangle, ImageIcon, Scale } from "lucide-react";

export default function AchilleaAdminRankedDisputesPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAchilleaAuth();
  const [disputes, setDisputes] = useState<RankedAdminDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Arbitrage dialog
  const [selectedDispute, setSelectedDispute] = useState<RankedAdminDispute | null>(null);
  const [score1, setScore1] = useState<number>(0);
  const [score2, setScore2] = useState<number>(0);
  const [forfeitUser, setForfeitUser] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const client = createAchilleaClient({ credentials: "include" });

  const loadDisputes = () => {
    return client.ranked
      .adminDisputes()
      .then(res => {
        if (res.ok && res.value) {
          setDisputes(res.value);
        }
      })
      .catch(() => {
        // silent fallback
      })
      .finally(() => {
        setRefreshing(false);
        setLoading(false);
      });
  };

  useEffect(() => {
    if (isAuthenticated) {
      void loadDisputes();
    }
  }, [isAuthenticated]);

  const handleOpenArbitrage = (d: RankedAdminDispute) => {
    setSelectedDispute(d);
    setScore1(d.player1?.submittedScore ?? 0);
    setScore2(d.player2?.submittedScore ?? 0);
    setForfeitUser("");
  };

  const handleValidateScore = async () => {
    if (!selectedDispute) return;
    setSubmitting(true);
    try {
      const res = await client.ranked.adminValidateLobby(selectedDispute.lobbyId, {
        scoreTeam1: score1,
        scoreTeam2: score2,
        forfeitUserId: forfeitUser.trim() || undefined,
      });

      if (res.ok) {
        setSelectedDispute(null);
        await loadDisputes();
      }
    } catch {
      // silent fallback
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelLobby = async (lobbyId: number) => {
    if (!confirm(`Annuler le lobby #${lobbyId} sans attribution de points ELO ?`)) return;
    setSubmitting(true);
    try {
      const res = await client.ranked.adminCancelLobby(lobbyId);
      if (res.ok) {
        setSelectedDispute(null);
        await loadDisputes();
      }
    } catch {
      // silent fallback
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!isAuthenticated || (user?.role ?? 0) < 2) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <div className="size-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
          <AlertTriangle className="size-8" />
        </div>
        <h1 className="text-2xl font-bold">Accès Arbitre Requis</h1>
        <p className="text-sm text-muted-foreground">
          L&apos;arbitrage des litiges de parties classées est restreint au staff compétitif Achilléa.
        </p>
        <Link href="/achillea/admins/dashboard">
          <Button variant="outline" className="mt-4">
            Retour au dashboard
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-6">
        <div className="space-y-1">
          <Link
            href="/achillea/admins/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-1"
          >
            <ArrowLeft className="size-3.5" />
            Retour au backoffice
          </Link>
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Gavel className="size-5" />
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Chambre d&apos;Arbitrage Ranked</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Résolution des contestations de score et validation des victoires au barème ELO.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRefreshing(true);
            void loadDisputes();
          }}
          disabled={refreshing}
          className="gap-2 text-xs"
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : disputes.length === 0 ? (
        <div className="p-12 text-center border border-border/60 rounded-xl bg-card/40 space-y-3">
          <CheckCircle2 className="size-10 text-emerald-400 mx-auto" />
          <div className="font-bold text-base">Aucun litige en attente</div>
          <p className="text-xs text-muted-foreground">
            Tous les matchs classés se sont conclus dans le respect du fair-play.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {disputes.map(d => (
            <Card key={d.lobbyId} className="border-border/60 bg-card/50 shadow-sm overflow-hidden">
              <CardHeader className="p-5 pb-3 border-b border-border/40 bg-muted/20">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Badge variant="outline" className="border-amber-500/30 text-amber-400">
                      Lobby #{d.lobbyId}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Mode : {d.mode === 2 ? "Duo (2v2)" : "Solo (1v1)"} · Signalé le{" "}
                      {new Date(d.createdAt).toLocaleDateString("fr-FR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleCancelLobby(d.lobbyId)}
                      className="text-xs"
                    >
                      Annuler le match
                    </Button>
                    <Button size="sm" onClick={() => handleOpenArbitrage(d)} className="gap-1.5 text-xs">
                      <Scale className="size-3.5" />
                      Trancher le litige
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Joueur 1 */}
                <div className="p-4 rounded-xl border border-border/60 bg-background/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Joueur 1 (Équipe A)
                    </span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      Score déclaré : {d.player1.submittedScore}
                    </Badge>
                  </div>

                  <div className="font-semibold text-base">
                    <Link href={`/achillea/users/${d.player1.userId}`} className="hover:text-primary transition">
                      {d.player1.displayName}
                    </Link>
                  </div>

                  {d.player1.claimedOpponentScore !== null && d.player1.claimedOpponentScore !== undefined && (
                    <div className="text-xs text-muted-foreground">
                      Revendique pour l&apos;adversaire :{" "}
                      <span className="font-bold text-foreground">{d.player1.claimedOpponentScore}</span>
                    </div>
                  )}

                  {d.player1.screenshotUrl ? (
                    <div className="space-y-1.5 pt-2">
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <ImageIcon className="size-3" /> Capture déposée :
                      </div>
                      <a
                        href={d.player1.screenshotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block relative aspect-video rounded-lg overflow-hidden border border-border/80 group"
                      >
                        <Image
                          src={d.player1.screenshotUrl}
                          alt="Preuve Joueur 1"
                          fill
                          className="object-cover group-hover:scale-105 transition"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition text-xs font-medium text-white">
                          Agrandir la capture
                        </div>
                      </a>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic pt-2">
                      Aucune capture d&apos;écran fournie.
                    </div>
                  )}
                </div>

                {/* Joueur 2 */}
                <div className="p-4 rounded-xl border border-border/60 bg-background/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Joueur 2 (Équipe B)
                    </span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      Score déclaré : {d.player2.submittedScore}
                    </Badge>
                  </div>

                  <div className="font-semibold text-base">
                    <Link href={`/achillea/users/${d.player2.userId}`} className="hover:text-primary transition">
                      {d.player2.displayName}
                    </Link>
                  </div>

                  {d.player2.claimedOpponentScore !== null && d.player2.claimedOpponentScore !== undefined && (
                    <div className="text-xs text-muted-foreground">
                      Revendique pour l&apos;adversaire :{" "}
                      <span className="font-bold text-foreground">{d.player2.claimedOpponentScore}</span>
                    </div>
                  )}

                  {d.player2.screenshotUrl ? (
                    <div className="space-y-1.5 pt-2">
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <ImageIcon className="size-3" /> Capture déposée :
                      </div>
                      <a
                        href={d.player2.screenshotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block relative aspect-video rounded-lg overflow-hidden border border-border/80 group"
                      >
                        <Image
                          src={d.player2.screenshotUrl}
                          alt="Preuve Joueur 2"
                          fill
                          className="object-cover group-hover:scale-105 transition"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition text-xs font-medium text-white">
                          Agrandir la capture
                        </div>
                      </a>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic pt-2">
                      Aucune capture d&apos;écran fournie.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialogue de Décision d'Arbitrage */}
      <Dialog open={!!selectedDispute} onOpenChange={open => !open && setSelectedDispute(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gavel className="size-5 text-amber-500" />
              Décision d&apos;Arbitrage — Lobby #{selectedDispute?.lobbyId}
            </DialogTitle>
            <DialogDescription>
              Saisis les scores officiels constatés sur les captures de fin de match. Le calcul de variation ELO sera
              appliqué immédiatement.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="scoreTeam1" className="font-semibold text-xs">
                  Buts {selectedDispute?.player1.displayName}
                </label>
                <input
                  id="scoreTeam1"
                  type="number"
                  min={0}
                  value={score1}
                  onChange={e => setScore1(parseInt(e.target.value, 10) || 0)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-center text-lg font-bold font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="scoreTeam2" className="font-semibold text-xs">
                  Buts {selectedDispute?.player2.displayName}
                </label>
                <input
                  id="scoreTeam2"
                  type="number"
                  min={0}
                  value={score2}
                  onChange={e => setScore2(parseInt(e.target.value, 10) || 0)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-center text-lg font-bold font-mono"
                />
              </div>
            </div>

            <div className="space-y-1.5 pt-2">
              <label htmlFor="forfeit" className="font-semibold text-xs">
                Joueur déclaré forfait (optionnel)
              </label>
              <select
                id="forfeit"
                value={forfeitUser}
                onChange={e => setForfeitUser(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Aucun forfait (match régulier)</option>
                {selectedDispute?.player1 && (
                  <option value={selectedDispute.player1.userId}>
                    Forfait : {selectedDispute.player1.displayName}
                  </option>
                )}
                {selectedDispute?.player2 && (
                  <option value={selectedDispute.player2.userId}>
                    Forfait : {selectedDispute.player2.displayName}
                  </option>
                )}
              </select>
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setSelectedDispute(null)} disabled={submitting}>
              Annuler
            </Button>
            <Button onClick={handleValidateScore} disabled={submitting} className="gap-2">
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Valider et Clore le Litige
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
