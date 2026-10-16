"use client";

import { Button } from "@rosegriffon/ui";
import { PatreonOauthScope } from "@rosegriffon/patreon-bun";
import { Heart, Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type Variant = "patron-link" | "creator-link" | "reactivate";

// Scopes additionnels demandés uniquement pour le link créateur. Better Auth
// Les merge avec les scopes patron définis dans la config genericOAuth, donc
// Pas besoin de redéclarer identity / identity.memberships ici.
const CREATOR_EXTRA_SCOPES: string[] = [
  PatreonOauthScope.Campaigns,
  PatreonOauthScope.CampaignMembers,
  PatreonOauthScope.CampaignMembersEmail,
  PatreonOauthScope.CampaignMembersAdress,
  PatreonOauthScope.CampaignPosts,
  PatreonOauthScope.ManageCampaignWebhooks,
];

interface Props {
  variant?: Variant;
  redirect?: string;
  className?: string;
  label?: string;
}

const LABELS: Record<Variant, string> = {
  "creator-link": "Lier le compte créateur Patreon",
  "patron-link": "Lier mon compte Patreon",
  reactivate: "Réactiver mon soutien",
};

/**
 * Bouton générique de link Patreon. Un seul provider genericOAuth `patreon`
 * (un seul redirect URI à whitelister côté portail Patreon). Pour le variant
 * `creator-link`, on ajoute à la volée les scopes campagne via le param
 * `scopes` accepté par `signIn.oauth2` (Better Auth les merge avec ceux
 * définis dans la config). Patreon n'accordera ces scopes que si l'utilisateur
 * connecté est bien propriétaire de la campagne.
 */
export function PatreonConnectButton({ variant = "patron-link", redirect, className, label }: Props) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const callbackURL = redirect ?? (variant === "creator-link" ? "/admin/patreon" : "/profil");
      const res = await authClient.signIn.social({
        callbackURL,
        provider: "patreon",
        ...(variant === "creator-link" ? { scopes: CREATOR_EXTRA_SCOPES } : {}),
      });
      const err = (res as { error?: { message?: string } | null })?.error;
      if (err) {
        toast.error(err.message ?? "Erreur lors du link Patreon");
        setLoading(false);
      }
    } catch (error) {
      console.error("[PatreonConnectButton]", error);
      toast.error("Erreur lors du link Patreon");
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleClick}
      disabled={loading}
      size="lg"
      className={cn("gap-2 bg-[#c9a958] text-[#0c1730] hover:bg-[#dab86a] font-semibold", className)}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : variant === "reactivate" ? (
        <Heart className="size-4" />
      ) : (
        <Link2 className="size-4" />
      )}
      {label ?? LABELS[variant]}
    </Button>
  );
}
