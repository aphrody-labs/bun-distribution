"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Bot,
  CalendarDays,
  CircleDollarSign,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
} from "lucide-react";
import { api, proxyAsset } from "@aphrody/admin-ui/client";

type DiscordMember = {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bot: boolean;
  joinedAt: string | null;
  roleIds: string[];
};

type MemberList = { members: DiscordMember[]; count: number; total: number };

type MemberProfile = {
  discordId: string;
  username: string | null;
  avatarUrl: string | null;
  level: number;
  xp: number;
  zeni: number;
  xpProgress: {
    current: number;
    nextLevelXp: number;
    nextLevel: number;
  } | null;
  equipped: {
    card: string | null;
    badge: string | null;
    color: string | null;
    title: string | null;
  };
  achievements: Array<{ code: string }>;
  inventory: Array<{ type: string; key: string }>;
};

const fmt = (value: number | null | undefined) =>
  (value ?? 0).toLocaleString("fr-FR");

export default function MemberProfilesPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const members = useQuery({
    queryKey: ["discord", "members", debouncedQuery],
    queryFn: () =>
      api.get<MemberList>(
        `/discord/members?limit=50${debouncedQuery ? `&search=${encodeURIComponent(debouncedQuery)}` : ""}`,
      ),
    staleTime: 30_000,
  });
  const selectedMember =
    members.data?.members.find((member) => member.id === selectedId) ?? null;
  const profile = useQuery({
    queryKey: ["member-profile", selectedId],
    queryFn: () => api.get<MemberProfile>(`/public/user/${selectedId}`),
    enabled: Boolean(selectedId && !selectedMember?.bot),
    retry: false,
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6 pb-8">
      <header className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-dbz-orange">
            Communauté
          </p>
          <h1 className="mt-2 font-saiyan text-4xl text-white">
            Profils membres
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/50">
            Recherchez un membre Discord et contrôlez sa progression DBFR depuis
            une fiche unique.
          </p>
        </div>
        {members.data && (
          <p className="text-sm text-white/40">
            {fmt(members.data.total)} membres sur le serveur
          </p>
        )}
      </header>

      <div className="grid min-h-[620px] gap-5 xl:grid-cols-[minmax(280px,380px)_1fr]">
        <section
          className="rounded-2xl border border-white/10 bg-white/[.025] p-4"
          aria-label="Recherche de membres"
        >
          <label className="relative block">
            <span className="sr-only">Pseudo ou identifiant Discord</span>
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pseudo ou ID Discord…"
              className="min-h-12 w-full rounded-xl border border-white/15 bg-black/25 pl-10 pr-4 text-base text-white outline-none placeholder:text-white/30 focus:border-dbz-orange focus:ring-2 focus:ring-dbz-orange/20"
            />
          </label>
          <p className="mt-3 text-xs text-white/35">
            {debouncedQuery
              ? `${members.data?.count ?? 0} résultat(s)`
              : "Saisissez un nom pour interroger tout le serveur."}
          </p>

          {members.isPending ? (
            <MemberListSkeleton />
          ) : members.isError ? (
            <p
              role="alert"
              className="mt-5 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200"
            >
              La liste des membres est momentanément indisponible.
            </p>
          ) : members.data?.members.length ? (
            <ul className="mt-4 max-h-[520px] space-y-1 overflow-y-auto pr-1">
              {members.data.members.map((member) => {
                const active = member.id === selectedId;
                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(member.id)}
                      aria-pressed={active}
                      className={`flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors ${
                        active
                          ? "border-dbz-orange/60 bg-dbz-orange/10"
                          : "border-transparent hover:border-white/10 hover:bg-white/[.04]"
                      }`}
                    >
                      <img
                        src={member.avatar}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full bg-black/30 object-cover"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
                          {member.displayName}
                          {member.bot && (
                            <Bot
                              className="h-3.5 w-3.5 shrink-0 text-dbz-blue-light"
                              aria-label="Bot"
                            />
                          )}
                        </span>
                        <span className="block truncate text-xs text-white/35">
                          @{member.username}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-5 rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-white/35">
              Aucun membre ne correspond à cette recherche.
            </p>
          )}
        </section>

        <section
          className="rounded-2xl border border-white/10 bg-[#161411] p-5 md:p-7"
          aria-live="polite"
        >
          {!selectedMember ? (
            <div className="grid h-full min-h-80 place-items-center text-center">
              <div>
                <UserRound
                  className="mx-auto h-10 w-10 text-white/20"
                  aria-hidden
                />
                <h2 className="mt-4 text-lg font-semibold text-white">
                  Sélectionnez un membre
                </h2>
                <p className="mt-1 text-sm text-white/35">
                  Sa progression et ses raccourcis apparaîtront ici.
                </p>
              </div>
            </div>
          ) : (
            <MemberDetail
              member={selectedMember}
              profile={profile.data}
              pending={profile.isPending}
              unavailable={profile.isError}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function MemberDetail({
  member,
  profile,
  pending,
  unavailable,
}: {
  member: DiscordMember;
  profile: MemberProfile | undefined;
  pending: boolean;
  unavailable: boolean;
}) {
  return (
    <div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <img
          src={member.avatar}
          alt=""
          className="h-24 w-24 rounded-2xl border-2 border-dbz-orange object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-2xl font-bold text-white">
              {member.displayName}
            </h2>
            {member.bot && (
              <span className="rounded-full bg-dbz-blue/20 px-2 py-1 text-xs text-dbz-blue-light">
                Bot
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-white/45">@{member.username}</p>
          <p className="mt-2 break-all font-mono text-xs text-white/30">
            {member.id}
          </p>
        </div>
        <Link
          href={`/profil/${member.id}`}
          target="_blank"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-white/15 px-4 text-sm font-semibold text-white/70 hover:border-dbz-orange hover:text-white"
        >
          Profil public <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2">
        <Info
          label="Arrivée sur le serveur"
          icon={CalendarDays}
          value={
            member.joinedAt
              ? new Date(member.joinedAt).toLocaleDateString("fr-FR", {
                  dateStyle: "long",
                })
              : "Non renseignée"
          }
        />
        <Info
          label="Rôles Discord"
          icon={ShieldCheck}
          value={fmt(member.roleIds.length)}
        />
      </dl>

      {member.bot ? (
        <p className="mt-6 rounded-xl border border-dbz-blue-light/20 bg-dbz-blue/10 p-4 text-sm text-dbz-blue-light">
          Les comptes automatisés n’ont pas de progression membre.
        </p>
      ) : pending ? (
        <div className="mt-6 h-56 animate-pulse rounded-2xl bg-white/[.04]" />
      ) : unavailable || !profile ? (
        <p className="mt-6 rounded-xl border border-yellow-300/20 bg-yellow-300/5 p-4 text-sm text-yellow-100/70">
          Ce membre est présent sur Discord mais n’a pas encore de progression
          DBFR, ou le bot ne répond pas.
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Niveau" value={fmt(profile.level)} icon={Trophy} />
            <Metric label="XP" value={fmt(profile.xp)} icon={Sparkles} />
            <Metric
              label="Zénis"
              value={fmt(profile.zeni)}
              icon={CircleDollarSign}
            />
            <Metric
              label="Succès"
              value={fmt(profile.achievements.length)}
              icon={ShieldCheck}
            />
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_240px]">
            <dl className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-black/20 px-4">
              {Object.entries(profile.equipped).map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <dt className="capitalize text-white/40">{key}</dt>
                  <dd className="truncate font-semibold text-white">
                    {value || "Non équipé"}
                  </dd>
                </div>
              ))}
            </dl>
            <img
              src={proxyAsset(`/canvas/profile/${member.id}`)}
              alt={`Carte de profil de ${member.displayName}`}
              className="w-full rounded-xl border border-white/10"
            />
          </div>
        </>
      )}
    </div>
  );
}

function Info({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof CalendarDays;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <dt className="flex items-center gap-2 text-xs text-white/35">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </dt>
      <dd className="mt-2 text-sm font-semibold text-white">{value}</dd>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Trophy;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <Icon className="h-4 w-4 text-dbz-orange" aria-hidden />
      <p className="mt-3 text-xs text-white/35">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function MemberListSkeleton() {
  return (
    <div className="mt-4 space-y-2" aria-label="Chargement des membres">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-16 animate-pulse rounded-xl bg-white/[.04]"
        />
      ))}
    </div>
  );
}
