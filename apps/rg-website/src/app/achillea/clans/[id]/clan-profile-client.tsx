"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createAchilleaClient, useAchilleaAuth } from "@/lib/achillea";
import type { ClanMemberDTO } from "@rosegriffon/achillea-types";
import { ClanMemberDistinction } from "@rosegriffon/achillea-types/enums/clanMemberRole";
import { UserAvatar } from "@/components/achillea/UserAvatar";
import { ClanOrgchart } from "@/components/achillea/ClanOrgchart";
import { getPublicClan, type PublicClan } from "@/lib/achillea/unified-clans";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@rosegriffon/ui";
import { Users, ArrowLeft, Check, ShieldAlert, Network } from "lucide-react";

export default function ClanProfilePage({
  id,
  initialClan = null,
  initialMembers = null,
}: {
  id: string;
  initialClan?: PublicClan | null;
  initialMembers?: ClanMemberDTO[] | null;
}) {
  const clanId = Number(id);
  const { isAuthenticated } = useAchilleaAuth();

  const [clan, setClan] = useState<PublicClan | null>(initialClan);
  const [members, setMembers] = useState<ClanMemberDTO[]>(initialMembers ?? []);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialClan == null || initialMembers == null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"members" | "orgchart">("members");

  const [applicationOpen, setApplicationOpen] = useState(false);
  const [selectedDistinction, setSelectedDistinction] = useState<ClanMemberDistinction>(ClanMemberDistinction.Player);
  const [applying, setApplying] = useState(false);
  const [applicationError, setApplicationError] = useState<string | null>(null);
  const [applicationSuccess, setApplicationSuccess] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadClan() {
      if (!Number.isSafeInteger(clanId) || clanId <= 0) {
        setError("Identifiant de clan invalide");
        setLoading(false);
        return;
      }
      if (initialClan && initialMembers) {
        setLoading(false);
        return;
      }
      setLoading(true);
      const client = createAchilleaClient();
      const [clanResult, membersResult] = await Promise.allSettled([
        getPublicClan(clanId),
        client.clans.members(clanId),
      ]);
      if (!isMounted) return;

      if (clanResult.status === "fulfilled") {
        setClan(clanResult.value);
      } else {
        setError("Clan introuvable ou temporairement indisponible");
      }

      if (membersResult.status === "fulfilled" && membersResult.value.ok) {
        setMembers(membersResult.value.value);
      } else {
        setMembersError("L’effectif du clan est temporairement indisponible.");
      }
      setLoading(false);
    }
    void loadClan();
    return () => {
      isMounted = false;
    };
  }, [clanId, initialClan, initialMembers]);

  const handleApply = async () => {
    if (!isAuthenticated) {
      window.location.href = `/login?redirect=${encodeURIComponent(`/achillea/clans/${clanId}`)}`;
      return;
    }
    setApplying(true);
    setApplicationError(null);
    try {
      const client = createAchilleaClient({ credentials: "include" });
      const res = await client.clans.createApplication(clanId, [selectedDistinction]);
      if (!res.ok) {
        setApplicationError("Envoi impossible. Vérifie ta connexion puis réessaie.");
        return;
      }
      if (!res.value.success) {
        setApplicationError(res.value.error ?? "La candidature n’a pas pu être envoyée.");
        return;
      }
      setApplicationSuccess(true);
      setTimeout(() => setApplicationOpen(false), 2000);
    } catch {
      setApplicationError("Une erreur a interrompu l’envoi. Réessaie.");
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <Skeleton className="h-8 w-40 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-3xl" />
        <Skeleton className="h-96 w-full rounded-3xl" />
      </div>
    );
  }

  if (error || !clan) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
        <ShieldAlert className="size-12 mx-auto text-amber-500" />
        <h2 className="text-xl font-bold text-on-surface">{error ?? "Clan introuvable"}</h2>
        <Button asChild variant="outline">
          <Link href="/achillea/clans">
            <ArrowLeft className="size-4 mr-2" />
            Retour à la liste des clans
          </Link>
        </Button>
      </div>
    );
  }

  // Classement des membres par rôle hiérarchique
  const roleWeights: Record<number, number> = {
    3: 0, // Président
    2: 1, // Vice-Président
    1: 2, // Membre
    0: 3, // À l'essai
  };
  const sortedMembers = [...members].sort(
    (a, b) => (roleWeights[a.clanRole as unknown as number] ?? 9) - (roleWeights[b.clanRole as unknown as number] ?? 9),
  );

  const roleLabel = (r: number) => {
    switch (r) {
      case 3:
        return "Président";
      case 2:
        return "Vice-Président";
      case 1:
        return "Membre";
      case 0:
        return "À l'essai";
      default:
        return "Membre";
    }
  };

  const roleBadgeVariant = (r: number) => {
    switch (r) {
      case 3:
        return "destructive" as const;
      case 2:
        return "default" as const;
      case 1:
        return "secondary" as const;
      default:
        return "outline" as const;
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Back button */}
      <Button asChild variant="ghost" size="sm" className="gap-1.5 -ml-2 text-on-surface-variant">
        <Link href="/achillea/clans">
          <ArrowLeft className="size-4" />
          Tous les clans
        </Link>
      </Button>

      {/* Banner & Header Card */}
      <div className="rounded-3xl border border-outline/20 bg-surface overflow-hidden shadow-xl">
        {/* Clan Banner Image */}
        <div className="relative h-44 sm:h-64 w-full bg-surface-variant">
          {clan.avatarUrl ? (
            <Image src={clan.avatarUrl} alt={`Avatar ${clan.name}`} fill unoptimized className="object-cover" />
          ) : (
            <div className="size-full bg-gradient-to-br from-[#6d00ce]/30 to-[#DFFF57]/20 flex items-center justify-center opacity-70" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
        </div>

        {/* Header Info */}
        <div className="relative px-6 pb-6 pt-0 sm:px-8 sm:pb-8 flex flex-col sm:flex-row gap-6 items-start sm:items-end -mt-16 sm:-mt-20">
          {/* Logo */}
          <div className="relative size-28 sm:size-36 rounded-2xl overflow-hidden border-4 border-surface bg-surface-variant shrink-0 shadow-2xl">
            {clan.avatarUrl ? (
              <Image src={clan.avatarUrl} alt={clan.name} fill unoptimized className="object-cover" />
            ) : (
              <div className="size-full flex items-center justify-center font-black text-3xl text-on-surface-variant">
                {clan.shortName}
              </div>
            )}
          </div>

          {/* Meta */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-black text-on-surface">
                <span className="text-primary mr-2">[{clan.shortName}]</span>
                {clan.name}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-on-surface-variant">
              <div className="flex items-center gap-1.5">
                <Users className="size-3.5 text-primary" />
                <span>{membersError ? "Effectif indisponible" : `${members.length} membres`}</span>
              </div>
            </div>
          </div>

          {/* Recrutement */}
          <div className="flex flex-col sm:items-end gap-3 self-stretch sm:self-auto shrink-0">
            {clan.isRecruiting && (
              /*
               * La fiche du clan est publique — identité, effectif, membres,
               * réseaux. Seule la CANDIDATURE demande une session.
               *
               * Sans session on envoie directement vers la connexion : ouvrir le
               * formulaire de motivation pour rediriger à l'envoi ferait perdre
               * le message déjà écrit.
               */
              <Button
                onClick={() =>
                  isAuthenticated
                    ? setApplicationOpen(true)
                    : window.location.assign(`/login?redirect=${encodeURIComponent(`/achillea/clans/${clanId}`)}`)
                }
                className="rounded-xl font-bold text-xs shadow-md"
              >
                {isAuthenticated ? "Postuler dans ce clan" : "Se connecter pour postuler"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Description & Biographie */}
      {clan.biography && (
        <Card className="rounded-2xl border-outline/20">
          <CardContent className="p-6 space-y-2">
            <h2 className="font-bold text-base text-on-surface">À propos du clan</h2>
            <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line">{clan.biography}</p>
          </CardContent>
        </Card>
      )}

      {/* Roster & Organigramme avec Onglets */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline/20 pb-3">
          <div className="flex items-center gap-2">
            <Users className="size-5 text-primary" />
            <h2 className="text-xl font-black text-on-surface">Structure du clan</h2>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={activeTab === "members" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("members")}
              className="text-xs font-semibold gap-1.5"
            >
              <Users className="size-3.5" />
              Membres ({members.length})
            </Button>
            <Button
              variant={activeTab === "orgchart" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("orgchart")}
              className="text-xs font-semibold gap-1.5"
            >
              <Network className="size-3.5" />
              Organigramme
            </Button>
          </div>
        </div>

        {membersError ? (
          <output className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-on-surface-variant">
            {membersError}
          </output>
        ) : activeTab === "members" ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sortedMembers.map(m => (
              <div
                key={m.user?.id}
                className="flex items-center justify-between p-3.5 rounded-2xl border border-outline/20 bg-surface hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar userId={m.user?.id} avatar={m.user?.avatar} name={m.user?.username} size="md" />
                  <div className="min-w-0">
                    <Link
                      href={`/achillea/users/${m.user?.id}`}
                      className="font-bold text-sm text-on-surface hover:text-primary transition-colors truncate block"
                    >
                      {m.user?.username}
                    </Link>
                    <span className="text-xs text-on-surface-variant">
                      Rejoint le {new Date(m.createdAt).toLocaleDateString("fr-FR")}
                    </span>
                  </div>
                </div>

                <Badge
                  variant={roleBadgeVariant(m.clanRole as unknown as number)}
                  className="text-xs shrink-0 font-bold"
                >
                  {roleLabel(m.clanRole as unknown as number)}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <ClanOrgchart members={members} />
        )}
      </div>

      {/* Modal Candidature */}
      <Dialog open={applicationOpen} onOpenChange={setApplicationOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rejoindre {clan.name}</DialogTitle>
            <DialogDescription>Choisis le rôle que tu souhaites rejoindre dans ce clan.</DialogDescription>
          </DialogHeader>

          {applicationSuccess ? (
            <div className="py-6 text-center space-y-2 text-green-600 font-bold">
              <Check className="size-10 mx-auto" />
              <p>Ta candidature a été transmise au clan avec succès !</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-on-surface">Poste souhaité au sein du clan</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Joueur compétitif", value: ClanMemberDistinction.Player },
                    { label: "Staff / Encadrement", value: ClanMemberDistinction.Staff },
                    { label: "Artiste / Graphiste", value: ClanMemberDistinction.Artist },
                    { label: "Créateur de contenu", value: ClanMemberDistinction.ContentCreator },
                  ].map(role => (
                    <button
                      key={role.value}
                      type="button"
                      aria-pressed={selectedDistinction === role.value}
                      onClick={() => setSelectedDistinction(role.value)}
                      className={`p-2.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                        selectedDistinction === role.value
                          ? "border-primary bg-primary/10 text-primary shadow-sm"
                          : "border-outline/20 bg-surface-variant/30 text-on-surface hover:border-outline/40"
                      }`}
                    >
                      {role.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {applicationError && (
            <p className="text-sm text-destructive" role="alert">
              {applicationError}
            </p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setApplicationOpen(false)}>
              Annuler
            </Button>
            {!applicationSuccess && (
              <Button onClick={handleApply} disabled={applying}>
                {applying ? "Envoi..." : "Envoyer ma candidature"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
