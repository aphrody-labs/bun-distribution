"use client";
import {
  type DiscordImageSize,
  discordUserAvatar,
  discordUserBanner,
} from "@shenron/config/public-urls";
import { useQuery } from "@tanstack/react-query";
import { Crown, Server, ShieldCheck, Mail, AlertCircle, ExternalLink } from "lucide-react";
import { apiAt, ApiError } from "@aphrody/admin-ui/client";
const api = apiAt("/api/admin/account");

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  banner: string | null;
  accent_color: number | null;
  email?: string;
  verified?: boolean;
  locale?: string;
  public_flags?: number;
  discriminator?: string;
}

interface MeResponse {
  user: DiscordUser;
}

interface SessionUser {
  id?: string;
  username?: string;
  avatar?: string | null;
  avatarUrl?: string;
  email?: string | null;
  source: "token" | "discord" | "better-auth";
}

interface GuildEntry {
  id: string;
  name: string;
  icon: string | null;
  iconUrl: string | null;
  owner: boolean;
  permissions: string;
  features: string[];
  approximate_member_count?: number;
  approximate_presence_count?: number;
  isCurrent: boolean;
}

interface MemberResponse {
  member: {
    nick: string | null;
    avatar: string | null;
    roles: string[];
    joined_at: string;
    premium_since: string | null;
    pending: boolean;
    communication_disabled_until: string | null;
  };
}

/**
 * Construit l'URL d'avatar Discord en gérant les 3 cas :
 *   - avatar custom : `cdn.discordapp.com/avatars/{id}/{hash}.{ext}` (anim si `a_…`)
 *   - pas d'avatar : avatar par défaut Discord (5 variantes selon `id >> 22 % 6`)
 *   - id manquant : null → fallback initiales côté affichage
 */
function avatarUrl(user: { id?: string; avatar?: string | null }, size = 256): string | null {
  if (!user.id) return null;
  return discordUserAvatar(user.id, user.avatar, { size: size as DiscordImageSize });
}

function bannerUrl(user: { id: string; banner: string | null }, size = 1024): string | null {
  return discordUserBanner(user.id, user.banner, { size: size as DiscordImageSize });
}

export default function AccountPage() {
  // Session locale (toujours dispo, peu importe la source d'auth)
  const session = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<{ authenticated: boolean; user?: SessionUser }>("/auth/me"),
    staleTime: 60_000,
  });

  // Discord OAuth — peut 401 si user logué via token admin ou Better Auth sans token Discord
  const me = useQuery({
    queryKey: ["discord", "me"],
    queryFn: () => api.get<MeResponse>("/discord/me"),
    retry: false,
    enabled: session.data?.authenticated === true,
  });
  const guilds = useQuery({
    queryKey: ["discord", "guilds"],
    queryFn: () => api.get<{ guilds: GuildEntry[] }>("/discord/guilds"),
    retry: false,
    enabled: !!me.data,
  });
  const member = useQuery({
    queryKey: ["discord", "guild-member"],
    queryFn: () => api.get<MemberResponse>("/discord/guild-member"),
    retry: false,
    enabled: !!me.data,
  });

  // 1. Pas encore prêt
  if (session.isLoading || me.isLoading) {
    return <div className="card text-zinc-500">Chargement du profil Discord…</div>;
  }

  // 2. Pas de session Discord OAuth → CTA pour se connecter
  if (me.isError || !me.data) {
    const sUser = session.data?.user;
    const isOAuthMissing =
      me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 503);
    return (
      <div className="space-y-4">
        <SessionCard user={sUser} />
        <div className="card border-amber-700/50 bg-amber-900/10">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div className="flex-1 space-y-2">
              <h3 className="font-semibold text-amber-300">Profil Discord indisponible</h3>
              <p className="text-sm text-zinc-300">
                {isOAuthMissing
                  ? "Tu es connecté via le jeton admin (ou Better Auth sans scope identify). Pour afficher ton profil Discord complet (avatar HD, bannière, serveurs, rôles), connecte-toi via OAuth Discord."
                  : me.error instanceof Error
                    ? `Erreur : ${me.error.message}`
                    : "Le serveur Discord n'a pas répondu. Réessaye dans un instant."}
              </p>
              <button
                type="button"
                onClick={async () => {
                  // Better Auth POST /api/auth/sign-in/social → renvoie { url } puis redirect.
                  // Aligné sur Login.tsx — le legacy /auth/discord utilise une redirect_uri
                  // potentiellement non enregistrée côté Discord App.
                  const res = await fetch("/api/auth/sign-in/social", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      provider: "discord",
                      callbackURL: "/admin/account",
                    }),
                  });
                  if (res.ok) {
                    const { url } = (await res.json()) as { url?: string };
                    if (url) {
                      window.location.href = url;
                      return;
                    }
                  }
                  // Fallback legacy si Better Auth indispo
                  window.location.href = "/signin?callbackUrl=%2Fadmin%2Faccount";
                }}
                className="btn btn-primary inline-flex w-fit items-center gap-2 text-sm"
              >
                Se connecter via Discord
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. OAuth OK → affichage complet
  const u = me.data.user;
  const banner = bannerUrl({ id: u.id, banner: u.banner });
  const accentBg =
    u.accent_color != null
      ? `#${u.accent_color.toString(16).padStart(6, "0")}`
      : "linear-gradient(to right, #18181b, #27272a)";
  const avatar = avatarUrl(u);

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden p-0">
        <div
          className="h-32 w-full"
          style={
            banner
              ? {
                  backgroundImage: `url(${banner})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : { background: accentBg }
          }
        />
        <div className="-mt-10 flex items-end gap-4 px-6">
          {avatar ? (
            <img
              src={avatar}
              alt=""
              className="h-24 w-24 rounded-full border-4 border-zinc-950 object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-zinc-950 bg-zinc-800 text-2xl font-bold text-zinc-300">
              {(u.global_name ?? u.username).slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="pb-4">
            <h2 className="text-2xl font-bold">{u.global_name ?? u.username}</h2>
            <p className="text-sm text-zinc-400">@{u.username}</p>
          </div>
        </div>
        <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-4">
          <Field icon={<ShieldCheck className="h-4 w-4" />} label="ID Discord" value={u.id} mono />
          <Field
            icon={<Mail className="h-4 w-4" />}
            label="Email"
            value={u.email ? `${u.email}${u.verified ? " ✓" : " (non vérifié)"}` : "—"}
          />
          <Field icon={<Server className="h-4 w-4" />} label="Locale" value={u.locale ?? "—"} />
          <Field
            icon={<Crown className="h-4 w-4" />}
            label="Public flags"
            value={u.public_flags?.toString() ?? "0"}
            mono
          />
        </div>
      </div>

      {member.isLoading && (
        <div className="card text-sm text-zinc-500">Chargement des données guild…</div>
      )}
      {member.isError && (
        <div className="card border-zinc-800 text-sm text-zinc-500">
          Membership guild indisponible
          {member.error instanceof Error ? ` (${member.error.message})` : ""}.
        </div>
      )}
      {member.data && (
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Membership sur la guild Shenron
          </h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-zinc-500">Surnom</dt>
              <dd>{member.data.member.nick ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Rejoint le</dt>
              <dd>{new Date(member.data.member.joined_at).toLocaleDateString("fr-FR")}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Boost depuis</dt>
              <dd>
                {member.data.member.premium_since
                  ? new Date(member.data.member.premium_since).toLocaleDateString("fr-FR")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Statut</dt>
              <dd>
                {member.data.member.communication_disabled_until &&
                new Date(member.data.member.communication_disabled_until) > new Date() ? (
                  <span className="badge badge-warning">timeout actif</span>
                ) : member.data.member.pending ? (
                  <span className="badge">en attente</span>
                ) : (
                  <span className="badge badge-success">actif</span>
                )}
              </dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="text-zinc-500">Rôles ({member.data.member.roles.length})</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {member.data.member.roles.length === 0 ? (
                  <span className="text-zinc-500">aucun rôle</span>
                ) : (
                  member.data.member.roles.map((rid) => (
                    <code key={rid} className="badge font-mono text-xs">
                      {rid}
                    </code>
                  ))
                )}
              </dd>
            </div>
          </dl>
        </div>
      )}

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Mes serveurs Discord
          {guilds.data ? ` (${guilds.data.guilds.length})` : ""}
        </h3>
        {guilds.isLoading && <div className="text-sm text-zinc-500">Chargement…</div>}
        {guilds.isError && (
          <div className="text-sm text-zinc-500">
            Liste de serveurs indisponible
            {guilds.error instanceof Error ? ` (${guilds.error.message})` : ""}.
          </div>
        )}
        {guilds.data && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {guilds.data.guilds.length === 0 && (
              <div className="text-sm text-zinc-500">Aucun serveur partagé.</div>
            )}
            {guilds.data.guilds.map((g) => (
              <div
                key={g.id}
                className={`flex items-center gap-3 rounded-lg border p-2 ${
                  g.isCurrent
                    ? "border-brand-500 bg-brand-500/10"
                    : "border-zinc-800 bg-zinc-950/40"
                }`}
              >
                {g.iconUrl ? (
                  <img src={g.iconUrl} alt="" className="h-10 w-10 rounded-full" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold">
                    {g.name
                      .split(" ")
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={g.name}>
                    {g.name}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {g.owner && "👑 "}
                    {g.approximate_member_count?.toLocaleString("fr-FR") ?? "?"} membres
                    {g.isCurrent && " · serveur du bot"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionCard({ user }: { user: SessionUser | undefined }) {
  if (!user) return null;
  const sourceLabel: Record<SessionUser["source"], string> = {
    token: "Jeton admin",
    discord: "OAuth Discord (legacy)",
    "better-auth": "Better Auth Discord",
  };
  const initials = (user.username ?? "??").slice(0, 2).toUpperCase();
  return (
    <div className="card">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Session courante
      </h3>
      <div className="flex items-center gap-4">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="h-16 w-16 rounded-full border border-zinc-800 object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800 font-semibold text-zinc-300">
            {initials}
          </div>
        )}
        <div className="space-y-1 text-sm">
          <div className="font-semibold">{user.username ?? "Utilisateur"}</div>
          {user.id && <div className="font-mono text-xs text-zinc-500">{user.id}</div>}
          {user.email && <div className="text-zinc-400">{user.email}</div>}
          <div className="text-xs">
            <span className="badge">{sourceLabel[user.source]}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs text-zinc-400">
        {icon}
        <span>{label}</span>
      </div>
      <p className={`text-sm ${mono ? "font-mono break-all" : ""}`}>{value}</p>
    </div>
  );
}
