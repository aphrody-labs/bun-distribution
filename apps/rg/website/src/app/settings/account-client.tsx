"use client";

import {
  AccountAddressForm,
  type AccountAddressValues,
  AccountAvatarCard,
  AccountConnections,
  AccountDangerZone,
  AccountEmailCard,
  type AccountLinkedAccount,
  AccountProfileForm,
  type AccountProfileValues,
  type AccountProviderConfig,
  type AccountSession,
  AccountSessions,
  AccountShell,
  type AccountTabId,
  TwoFactorCard,
} from "@rosegriffon/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { getBrowserStorage } from "@/lib/storage/browser";

import { updateAddress, updateAvatarUrl, updateProfile } from "./actions";
import { revokeAccountSession } from "./session-actions";

interface AccountClientProps {
  userId: string;
  email?: string | null;
  initialTab: AccountTabId;
  backHref: string;
  avatarUrl: string | null;
  username: string | null;
  role: string | null;
  twoFactorEnabled: boolean;
  profile: AccountProfileValues;
  address: AccountAddressValues;
  accounts: (AccountLinkedAccount & { id: string })[];
  sessions: AccountSession[];
}

/**
 * Câblage côté site principal de la page « Mon compte » partagée.
 *
 * Toute la présentation vient de `@rosegriffon/ui` : ce fichier ne contient
 * que ce qui est propre au site — instance Better Auth, stockage Supabase,
 * fournisseurs OAuth proposés et actions serveur.
 */
/** Rend la phrase envoyée par la route, ou un repli — jamais un code HTTP nu. */
async function raisonHttp(reponse: Response, defaut: string): Promise<string> {
  try {
    const charge = (await reponse.json()) as { error?: string };
    return charge.error || defaut;
  } catch {
    return defaut;
  }
}

export function AccountClient({
  userId,
  email,
  initialTab,
  backHref,
  avatarUrl,
  username,
  role,
  twoFactorEnabled,
  profile,
  address,
  accounts,
  sessions,
}: AccountClientProps) {
  const router = useRouter();

  const uploadAvatar = async (file: File) => {
    const storage = getBrowserStorage();
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "png";
    // Chemin unique par téléversement : un nom fixe renverrait la même URL
    // publique, que le navigateur et le CDN resservent depuis leur cache.
    const path = `${userId}/avatar-${Date.now()}.${extension}`;

    const { error: uploadError } = await storage
      .from("avatars")
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const {
      data: { publicUrl },
    } = storage.from("avatars").getPublicUrl(path);

    const res = await updateAvatarUrl(publicUrl);
    if (res.error) {
      throw new Error(res.error);
    }
    router.refresh();
    return publicUrl;
  };

  const reload = () => router.refresh();

  const unlink = async (providerId: string) => {
    const account = accounts.find((linked) => linked.provider === providerId);
    if (!account) {
      throw new Error("Compte lié introuvable.");
    }
    const { error } = await authClient.unlinkAccount({ accountId: account.id });
    if (error) {
      throw new Error(error.message ?? "Impossible de dissocier ce compte.");
    }
    toast.success("Compte dissocié.");
    reload();
  };

  /** Rattache un fournisseur social et laisse Better Auth rediriger. */
  const link = async (provider: "discord" | "google" | "twitch") => {
    const { error } = await authClient.linkSocial({
      callbackURL: "/settings?tab=connections",
      provider,
    });
    if (error) {
      throw new Error(error.message ?? "Impossible de lier ce compte.");
    }
  };

  const providers: AccountProviderConfig[] = [
    {
      id: "discord",
      onLink: () => link("discord"),
      onUnlink: () => unlink("discord"),
    },
    {
      id: "google",
      onLink: () => link("google"),
      onUnlink: () => unlink("google"),
    },
    {
      id: "twitch",
      onLink: () => link("twitch"),
      onUnlink: () => unlink("twitch"),
    },
    {
      id: "patreon",
      // Patreon passe par le plugin genericOAuth, pas par `linkSocial`.
      onLink: async () => {
        const res = await authClient.signIn.social({
          callbackURL: "/settings?tab=connections",
          provider: "patreon",
        });
        const error = (res as { error?: { message?: string } | null })?.error;
        if (error) {
          throw new Error(error.message ?? "Erreur lors de la liaison Patreon.");
        }
      },
      onRefresh: async () => {
        const res = await fetch("/api/auth/patreon/refresh", {
          method: "POST",
        });
        if (!res.ok) {
          // Le message de la route, pas son code : « HTTP 409 » ne dit pas à
          // quelqu'un ce qu'il doit faire, « lie d'abord Discord » si.
          throw new Error(await raisonHttp(res, "Synchronisation impossible."));
        }
        toast.success("Patreon synchronisé.");
        reload();
      },
      onUnlink: async () => {
        const res = await fetch("/api/auth/patreon/disconnect", {
          method: "POST",
        });
        if (!res.ok) {
          throw new Error(await raisonHttp(res, "Dissociation impossible."));
        }
        toast.success("Compte Patreon dissocié.");
        reload();
      },
    },
  ];

  return (
    <AccountShell
      email={email}
      backHref={backHref}
      backLabel="Retour à mon profil"
      initialTab={initialTab}
      tabs={[
        {
          content: (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <AccountAvatarCard
                  avatarUrl={avatarUrl}
                  username={username}
                  role={role}
                  // Sans pseudo, la page publique n'existe pas encore : le
                  // bouton ne s'affiche pas plutôt que de mener à un 404.
                  profileHref={username ? `/profil/${encodeURIComponent(username)}` : null}
                  onUpload={uploadAvatar}
                />
              </div>
              <div className="lg:col-span-2">
                <AccountProfileForm
                  values={profile}
                  profileUrlPrefix="/profil/"
                  showCosmetics
                  onSubmit={async (values) => updateProfile(values)}
                />
                <section className="mt-6 rounded-xl border border-border bg-muted/20 p-4">
                  <h2 className="text-sm font-semibold">Espace Achilléa</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Le portefeuille et la compétition utilisent ce même compte Rose Griffon.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm font-medium">
                    <Link className="text-primary hover:underline" href="/achillea/wallet">
                      Portefeuille ACH
                    </Link>
                    <Link
                      className="text-primary hover:underline"
                      href="/achillea/ranked/leaderboard"
                    >
                      Classement
                    </Link>
                  </div>
                </section>
              </div>
            </div>
          ),
          id: "profile",
        },
        {
          content: <AccountAddressForm values={address} onSubmit={updateAddress} />,
          id: "address",
        },
        {
          content: <AccountConnections providers={providers} accounts={accounts} />,
          id: "connections",
        },
        {
          content: (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <AccountEmailCard
                  currentEmail={email}
                  onChangeEmail={async (newEmail) => {
                    const { error } = await authClient.changeEmail({
                      callbackURL: "/settings?tab=security",
                      newEmail,
                    });
                    return { error: error?.message ?? null };
                  }}
                />
                <TwoFactorCard
                  enabled={twoFactorEnabled}
                  // Aucun compte du site principal n'a de mot de passe :
                  // `emailAndPassword` n'y est pas activé, on s'y connecte par
                  // Discord, Google, Twitch ou Patreon. Le réclamer refuserait
                  // tout le monde.
                  demandeMotDePasse={false}
                  onChangement={reload}
                  actions={{
                    demarrer: async () => {
                      const { data, error } = await authClient.twoFactor.enable({ method: "totp" });
                      if (error || !data || data.method !== "totp") {
                        throw new Error(error?.message ?? "Activation impossible.");
                      }
                      return {
                        backupCodes: data.backupCodes,
                        totpURI: data.totpURI,
                      };
                    },
                    confirmer: async (code) => {
                      const { error } = await authClient.twoFactor.verifyTotp({
                        code,
                      });
                      if (error) {
                        throw new Error(error.message ?? "Code refusé.");
                      }
                    },
                    desactiver: async () => {
                      const { error } = await authClient.twoFactor.disable({});
                      if (error) {
                        throw new Error(error.message ?? "Désactivation impossible.");
                      }
                    },
                    regenererCodes: async () => {
                      const { data, error } = await authClient.twoFactor.generateBackupCodes({});
                      if (error || !data) {
                        throw new Error(error?.message ?? "Impossible de régénérer les codes.");
                      }
                      return data.backupCodes;
                    },
                  }}
                />
              </div>

              <AccountSessions
                sessions={sessions}
                onRevoke={async (id) => {
                  const { error } = await revokeAccountSession(id);
                  if (error) {
                    throw new Error(error);
                  }
                  reload();
                }}
                onRevokeOthers={async () => {
                  // `revokeOtherSessions` et pas `revokeSessions` : le second
                  // supprime aussi la session courante et déconnecte.
                  const { error } = await authClient.revokeOtherSessions();
                  if (error) {
                    throw new Error(error.message ?? "Révocation refusée.");
                  }
                  reload();
                }}
              />

              <AccountDangerZone
                // Ce que la suppression emporte VRAIMENT, vérifié sur les clés
                // étrangères de la base : `comments`, `user_teams` et
                // `avatar_saves` pendent au profil en CASCADE. Les commandes,
                // elles, ne sont PAS supprimées — `orders.user_id` passe à
                // `NULL` : une facture se conserve, et annoncer sa disparition
                // était faux dans les deux sens (on promettait un effacement
                // qui n'a pas lieu, et on inquiétait sur une garantie légale).
                losses={[
                  "Ton profil public, ta bio, tes badges et ton adresse postale.",
                  "Tes commentaires, tes équipes enregistrées et tes avatars sauvegardés.",
                  "Ton accès : la connexion Discord, Google, Twitch ou Patreon liée à ce compte.",
                ]}
                kept={[
                  "Tes commandes en boutique restent, détachées de ton compte — une facture doit pouvoir être retrouvée.",
                ]}
                onDelete={async () => {
                  const { error } = await authClient.deleteUser({
                    callbackURL: "/",
                  });
                  return { error: error?.message ?? null };
                }}
              />
            </div>
          ),
          id: "security",
        },
      ]}
    />
  );
}
