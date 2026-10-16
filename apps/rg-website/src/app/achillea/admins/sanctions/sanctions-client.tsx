"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAchilleaAuth, createAchilleaClient } from "@/lib/achillea";
import type { Sanction } from "@rosegriffon/achillea-types/domain/sanction";
import {
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
import { ShieldAlert, ArrowLeft, Plus, RefreshCw, Loader2, CheckCircle2, Ban, Undo2 } from "lucide-react";

export default function AchilleaAdminSanctionsPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAchilleaAuth();
  const [sanctions, setSanctions] = useState<Sanction[]>([]);
  const [loading, setLoading] = useState(true);
  const [clockTime, setClockTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClockTime(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState("");
  const [targetGuildId] = useState("");
  const [sanctionType, setSanctionType] = useState<string>("warn");
  const [reason, setReason] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [creating, setCreating] = useState(false);

  // Revoke dialog
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [selectedSanction, setSelectedSanction] = useState<Sanction | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);

  const client = createAchilleaClient({ credentials: "include" });

  const loadSanctions = () => {
    return client.sanctions
      .list({
        active: activeOnly ? true : undefined,
        pageSize: 50,
      })
      .then(res => {
        if (res.ok && res.value?.data) {
          setSanctions(res.value.data);
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
      void loadSanctions();
    }
  }, [isAuthenticated, activeOnly]);

  const handleCreateSanction = async () => {
    if (!targetUserId.trim()) return;
    setCreating(true);
    try {
      const durationSec = durationMinutes ? parseInt(durationMinutes, 10) * 60 : undefined;
      const res = await client.sanctions.create({
        userId: targetUserId.trim(),
        guildId: targetGuildId.trim() || "0",
        type: sanctionType as any,
        reason: reason.trim() || undefined,
        durationSec,
      });

      if (res.ok) {
        setCreateOpen(false);
        setTargetUserId("");
        setReason("");
        setDurationMinutes("");
        await loadSanctions();
      }
    } catch {
      // silent fallback
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeSanction = async () => {
    if (!selectedSanction) return;
    setRevoking(true);
    try {
      const res = await client.sanctions.revoke(selectedSanction.id, revokeReason.trim() || undefined);
      if (res.ok) {
        setRevokeOpen(false);
        setSelectedSanction(null);
        setRevokeReason("");
        await loadSanctions();
      }
    } catch {
      // silent fallback
    } finally {
      setRevoking(false);
    }
  };

  if (authLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!isAuthenticated || (user?.role ?? 0) < 2) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <div className="size-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
          <ShieldAlert className="size-8" />
        </div>
        <h1 className="text-2xl font-bold">Accès Restreint aux Administrateurs</h1>
        <p className="text-sm text-muted-foreground">
          Seuls les administrateurs et super-administrateurs peuvent gérer les sanctions globales.
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
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
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
            <span className="p-2 rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20">
              <ShieldAlert className="size-5" />
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Registre des Sanctions</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Avertissements, exclusions temporaires de ranked et bannissements définitifs.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant={activeOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveOnly(!activeOnly)}
            className="text-xs"
          >
            {activeOnly ? "Sanctions actives" : "Toutes les sanctions"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRefreshing(true);
              void loadSanctions();
            }}
            disabled={refreshing}
            className="gap-2 text-xs"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </Button>

          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="gap-1.5 text-xs bg-rose-600 hover:bg-rose-700 text-white"
          >
            <Plus className="size-3.5" />
            Émettre une sanction
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : sanctions.length === 0 ? (
        <div className="p-12 text-center border border-border/60 rounded-xl bg-card/40 space-y-3">
          <CheckCircle2 className="size-10 text-emerald-400 mx-auto" />
          <div className="font-bold text-base">Aucune sanction trouvée</div>
          <p className="text-xs text-muted-foreground">
            {activeOnly
              ? "Aucune sanction active n'est actuellement en vigueur."
              : "Le registre des sanctions est vierge."}
          </p>
        </div>
      ) : (
        <div className="border border-border/60 rounded-xl overflow-hidden bg-card/50">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/40 border-b border-border/60">
                <tr>
                  <th className="px-4 py-3">Joueur (Discord ID)</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Motif</th>
                  <th className="px-4 py-3">Date d&apos;émission</th>
                  <th className="px-4 py-3">Expiration</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {sanctions.map(s => {
                  const isRevoked = !!s.revokedAt;
                  const isExpired = s.expiresAt && new Date(s.expiresAt).getTime() < clockTime;
                  const isActive = !isRevoked && !isExpired;

                  return (
                    <tr key={s.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 font-mono text-xs font-semibold">
                        <Link href={`/achillea/users/${s.userId}`} className="hover:text-primary transition underline">
                          {s.userId}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={`text-xs uppercase font-bold ${
                            s.type === "ban"
                              ? "border-red-500 text-red-400 bg-red-500/10"
                              : s.type === "warn"
                                ? "border-amber-500 text-amber-400 bg-amber-500/10"
                                : "border-sky-500 text-sky-400 bg-sky-500/10"
                          }`}
                        >
                          {s.type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs max-w-xs truncate text-muted-foreground">
                        {s.reason || "Non spécifié"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(s.createdAt).toLocaleDateString("fr-FR")}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {isRevoked ? (
                          <span className="text-muted-foreground italic">Révoquée</span>
                        ) : isExpired ? (
                          <span className="text-muted-foreground">Expirée</span>
                        ) : s.expiresAt ? (
                          <span className="text-amber-400 font-medium">
                            {new Date(s.expiresAt).toLocaleDateString("fr-FR")}
                          </span>
                        ) : (
                          <span className="text-rose-400 font-bold">Permanente</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isActive && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedSanction(s);
                              setRevokeOpen(true);
                            }}
                            className="text-xs gap-1 border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                          >
                            <Undo2 className="size-3" />
                            Révoquer
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dialogue d'émission de sanction */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-500">
              <Ban className="size-5" />
              Émettre une Sanction
            </DialogTitle>
            <DialogDescription>
              La sanction sera enregistrée au registre public et appliquée immédiatement.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-sm">
            <div className="space-y-1.5">
              <label htmlFor="userId" className="font-medium">
                Discord User ID *
              </label>
              <input
                id="userId"
                type="text"
                value={targetUserId}
                onChange={e => setTargetUserId(e.target.value)}
                placeholder="ex: 123456789012345678"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sanctionType" className="font-medium">
                Type de sanction
              </label>
              <select
                id="sanctionType"
                value={sanctionType}
                onChange={e => setSanctionType(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="warn">Avertissement (Warn)</option>
                <option value="mute">Mute temporaire</option>
                <option value="ranked_ban">Bannissement du Ladder Ranked</option>
                <option value="ban">Bannissement Global</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="duration" className="font-medium">
                Durée (en minutes, laisser vide si permanent)
              </label>
              <input
                id="duration"
                type="number"
                value={durationMinutes}
                onChange={e => setDurationMinutes(e.target.value)}
                placeholder="ex: 1440 pour 24 heures"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="reason" className="font-medium">
                Motif
              </label>
              <textarea
                id="reason"
                rows={3}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Préciser l'infraction constatée..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Annuler
            </Button>
            <Button
              onClick={handleCreateSanction}
              disabled={creating || !targetUserId.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white gap-2"
            >
              {creating && <Loader2 className="size-4 animate-spin" />}
              Confirmer la sanction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue de révocation */}
      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Révoquer la Sanction</DialogTitle>
            <DialogDescription>L&apos;utilisateur recouvrera ses droits d&apos;accès immédiatement.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm">
            <p className="text-xs text-muted-foreground">
              Sanction #{selectedSanction?.id} sur le compte{" "}
              <span className="font-mono text-foreground font-semibold">{selectedSanction?.userId}</span>
            </p>

            <div className="space-y-1.5">
              <label htmlFor="revokeReason" className="font-medium">
                Motif de révocation (optionnel)
              </label>
              <textarea
                id="revokeReason"
                rows={3}
                value={revokeReason}
                onChange={e => setRevokeReason(e.target.value)}
                placeholder="ex: Appel accepté, erreur d'identification..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeOpen(false)} disabled={revoking}>
              Annuler
            </Button>
            <Button onClick={handleRevokeSanction} disabled={revoking} className="gap-2">
              {revoking && <Loader2 className="size-4 animate-spin" />}
              Lever la sanction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
