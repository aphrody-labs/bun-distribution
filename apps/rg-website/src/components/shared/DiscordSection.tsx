"use client";

import { Button, DiscordIcon } from "@rosegriffon/ui";
import Image from "next/image";
import { useEffect, useState } from "react";

import { serveurDiscord, type ServeurDiscord } from "@/lib/discord";

/** Pastilles de présence — tokens sémantiques, jamais `bg-green-500` & co. */
const COULEUR_STATUT: Record<string, string> = {
  dnd: "bg-destructive",
  idle: "bg-alerte",
  offline: "bg-muted-foreground",
  online: "bg-succes",
};

interface MembreDiscord {
  id: string;
  username: string;
  avatar_url?: string;
  status: "online" | "idle" | "dnd" | "offline";
}

interface DonneesWidget {
  name: string;
  presence_count: number;
  member_count: number;
  instant_invite: string | null;
  members: MembreDiscord[];
}

interface DiscordSectionProps {
  serveur?: ServeurDiscord;
  lienInvitation?: string;
  compact?: boolean;
}

/** Colonne de droite : membres en ligne, via le widget public du serveur. */
function WidgetDiscord({
  donnees,
  chargement,
  erreur,
  lienInvitation,
}: {
  donnees: DonneesWidget | null;
  chargement: boolean;
  erreur: boolean;
  lienInvitation: string;
}) {
  if (chargement) {
    return (
      <div
        className="flex size-full items-center justify-center p-6 text-muted-foreground"
        aria-label="Chargement du Discord"
      >
        <div className="size-10 animate-spin rounded-full border-2 border-border border-b-primary" />
      </div>
    );
  }

  if (erreur || !donnees) {
    return (
      <div className="flex size-full items-center justify-center gap-3 p-6">
        <DiscordIcon className="size-6 text-discord" aria-hidden />
        <Button asChild className="bg-discord font-bold text-rg-sur-marine hover:bg-discord/90">
          <a href={lienInvitation} target="_blank" rel="noopener noreferrer">
            Rejoindre le Discord
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex size-full flex-col p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <DiscordIcon className="size-5 shrink-0 text-discord" aria-hidden />
          <h3 className="truncate text-base font-bold text-foreground sm:text-lg">{donnees.name}</h3>
        </div>
        <Button asChild size="sm" className="bg-discord font-bold text-rg-sur-marine hover:bg-discord/90">
          <a href={donnees.instant_invite ?? lienInvitation} target="_blank" rel="noopener noreferrer">
            Rejoindre
          </a>
        </Button>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{donnees.presence_count}</span> en ligne
        {" • "}
        <span className="font-semibold text-foreground">{donnees.member_count}</span> membres
      </p>

      <ul className="min-h-0 grow flex flex-col gap-2 overflow-y-auto pr-1 scrollbar-thin">
        {donnees.members.map(membre => (
          <li key={membre.id} className="flex items-center gap-3">
            <div className="relative shrink-0">
              <Image
                src={membre.avatar_url || "/default-avatar.webp"}
                alt=""
                width={32}
                height={32}
                className="size-8 rounded-full object-cover"
                unoptimized
              />
              <span
                className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-muted ${
                  COULEUR_STATUT[membre.status] ?? COULEUR_STATUT.offline
                }`}
              />
            </div>
            <span className="truncate text-sm text-foreground">{membre.username}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DiscordSection({
  serveur = serveurDiscord("rose-griffon"),
  lienInvitation,
  compact = false,
}: DiscordSectionProps) {
  const invitation = lienInvitation ?? serveur.invitation;
  const [donnees, setDonnees] = useState<DonneesWidget | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    let annule = false;

    const recuperer = async () => {
      try {
        const reponse = await fetch(`https://discord.com/api/guilds/${serveur.guildId}/widget.json`);
        if (!reponse.ok) {
          throw new Error(`Widget Discord indisponible (${reponse.status})`);
        }
        const brut = await reponse.json();
        if (annule) {
          return;
        }
        setDonnees({
          instant_invite: brut.instant_invite ?? null,
          member_count: brut.members?.length ?? 0,
          members: (brut.members ?? []).map((m: MembreDiscord) => ({
            avatar_url: m.avatar_url,
            id: m.id,
            status: m.status ?? "offline",
            username: m.username,
          })),
          name: brut.name,
          presence_count: brut.presence_count ?? 0,
        });
      } catch (error) {
        if (!annule) {
          console.error("Récupération du widget Discord impossible :", error);
          setErreur(true);
        }
      } finally {
        if (!annule) {
          setChargement(false);
        }
      }
    };

    void recuperer();

    return () => {
      annule = true;
    };
  }, [serveur.guildId]);

  return (
    <div
      className={
        compact
          ? "h-[18rem] overflow-hidden rounded-2xl border border-border bg-card"
          : "mx-auto h-[22rem] w-full max-w-7xl overflow-hidden rounded-2xl border border-border bg-card sm:h-[26rem]"
      }
    >
      <WidgetDiscord donnees={donnees} chargement={chargement} erreur={erreur} lienInvitation={invitation} />
    </div>
  );
}
