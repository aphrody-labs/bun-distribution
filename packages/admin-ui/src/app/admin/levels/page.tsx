"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserSelect } from "@aphrody/admin-ui/components/admin/UserSelect";
import {
  Alerte,
  Bulle,
  Chargement,
  CocheCercle,
  Corbeille,
  Couronne,
  Croix,
  Eclair,
  Enregistrer,
  Etoile,
  Groupe,
  Horloge,
  Micro,
  Piece,
  Plus,
  Reinitialiser,
  Tendance,
  Trophee,
} from "@/components/icones";
import { type FormEvent, useRef, useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import { formatDuration } from "@aphrody/admin-ui/format";
import { RoleBadge, RoleSelect } from "@aphrody/admin-ui/components/admin/RoleSelect";
import { RolePicker } from "@aphrody/admin-ui/components/admin/RolePicker";
import { formatZeni } from "@/lib/zeni";

interface Threshold {
  level: number;
  xp: number;
}

interface ConfigResponse {
  thresholds: Threshold[];
  defaults: Record<string, number | string | boolean>;
  overrides: Record<string, string>;
}

interface DistributionBucket {
  level: number;
  minXp: number;
  maxXp: number;
  count: number;
}

interface LevelReward {
  level: number;
  roleId: string;
  xpThreshold: number;
  zeniBonus: number;
}

interface RaceReward {
  race: string;
  level: number;
  roleId: string;
}

// Races du serveur (aligné sur RACE_IDS côté bot : lib/races.ts).
const RACE_OPTIONS: { id: string; label: string }[] = [
  { id: "saiyan", label: "Saiyan" },
  { id: "humain", label: "Humain / Terrien" },
  { id: "namek", label: "Namek" },
  { id: "mutant", label: "Mutant / Freezer" },
  { id: "cyborg", label: "Cyborg" },
  { id: "majin", label: "Majin" },
];

const raceLabel = (race: string): string => RACE_OPTIONS.find((r) => r.id === race)?.label ?? race;

interface TopUser {
  id: string;
  xp: number;
  zeni: number;
  lastLevelReached: number;
  messageCount: number;
  totalVoiceMs: number;
  dailyStreak: number;
}

type Metric = "xp" | "zeni" | "voice" | "streak" | "messages";

// Modale de confirmation pour les actions destructives
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="card w-full max-w-sm space-y-4 border border-red-500/40">
        <div className="flex items-start gap-3">
          <Alerte className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="mt-1 text-sm text-zinc-400">{message}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto btn btn-ghost px-1 py-1"
            aria-label="Fermer"
          >
            <Croix className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn btn-primary bg-red-600 hover:bg-red-500 border-red-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LevelsPage() {
  const config = useQuery({
    queryKey: ["levels", "config"],
    queryFn: () => api.get<ConfigResponse>("/levels/config"),
  });
  const distribution = useQuery({
    queryKey: ["levels", "distribution"],
    queryFn: () => api.get<{ buckets: DistributionBucket[] }>("/levels/distribution"),
  });
  const rewards = useQuery({
    queryKey: ["levels", "rewards"],
    queryFn: () => api.get<{ rewards: LevelReward[] }>("/levels/rewards"),
  });
  const raceRewards = useQuery({
    queryKey: ["levels", "race-rewards"],
    queryFn: () => api.get<{ rewards: RaceReward[] }>("/levels/race-rewards"),
  });

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="card">
        <div className="flex items-center gap-2">
          <Trophee className="h-5 w-5 text-brand-400" />
          <h2 className="text-lg font-semibold">Niveaux et XP</h2>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Cette page vous permet de consulter les paliers d&apos;expérience, la répartition des
          joueurs, gérer les récompenses de niveau et modifier manuellement l&apos;XP ou les zénis
          d&apos;un membre. Le palier ultime &laquo;&nbsp;It&apos;s over 9
          millions&nbsp;!&nbsp;&raquo; correspond à 9&nbsp;000&nbsp;000 XP.
        </p>
      </div>

      {config.isError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
          <Alerte className="h-4 w-4 shrink-0" />
          Impossible de charger la configuration. Le bot est-il en ligne ?
        </div>
      )}

      <XpTuningCard config={config.data} loading={config.isLoading} />
      <ThresholdCurveCard />
      <ThresholdsCard
        config={config.data}
        distribution={distribution.data?.buckets}
        loading={distribution.isLoading}
      />
      <RewardsCard rewards={rewards.data?.rewards ?? []} loading={rewards.isLoading} />
      <RaceRewardsCard rewards={raceRewards.data?.rewards ?? []} loading={raceRewards.isLoading} />
      <TopsCard />
      <ManualActionsCard />
    </div>
  );
}

interface SettingSchema {
  key: string;
  type: "int" | "float" | "snowflake" | "string" | "bool";
  description: string;
  default?: number | string | boolean;
  min?: number;
  max?: number;
}

interface TuningSection {
  id: string;
  title: string;
  icon: typeof Bulle;
  hint: string;
  fields: { key: string; label: string }[];
}

// Réglages `xp.*` et `zeni.*` du bot (SettingsService.SETTINGS_KEYS), groupés
// par levier. Types, bornes et défauts viennent du schéma servi par le bot.
const TUNING_SECTIONS: TuningSection[] = [
  {
    id: "message",
    title: "Écrit",
    icon: Bulle,
    hint: "Un gain tiré entre le minimum et le maximum, au plus une fois par délai.",
    fields: [
      { key: "xp.message.min", label: "XP minimum par message" },
      { key: "xp.message.max", label: "XP maximum par message" },
      { key: "xp.message.cooldown_ms", label: "Délai entre deux gains (ms)" },
    ],
  },
  {
    id: "voice",
    title: "Vocal",
    icon: Micro,
    hint: "Parts de 0 à 1 : 1 = gain entier, 0 = aucun gain. Un membre coupé par un modérateur ne gagne jamais.",
    fields: [
      { key: "xp.voice.per_minute", label: "XP par minute" },
      { key: "xp.voice.min_members", label: "Membres requis pour gagner" },
      { key: "xp.voice.muted_ratio", label: "Part micro coupé" },
      { key: "xp.voice.deafened_ratio", label: "Part casque coupé" },
    ],
  },
  {
    id: "group",
    title: "Vocal à plusieurs",
    icon: Groupe,
    hint: "Bonus par membre au-delà du premier : 0,1 donne ×1,1 à deux et ×1,3 à quatre.",
    fields: [
      { key: "xp.voice.group.bonus_per_member", label: "Bonus par membre en plus" },
      { key: "xp.voice.group.max_multiplier", label: "Multiplicateur de groupe maximal" },
    ],
  },
  {
    id: "night",
    title: "Boost de nuit",
    icon: Etoile,
    hint: "Heures locales du fuseau choisi ; la fin est exclue et la plage peut passer minuit (22 à 7).",
    fields: [
      { key: "xp.night.enabled", label: "Boost de nuit" },
      { key: "xp.night.start_hour", label: "Début (heure)" },
      { key: "xp.night.end_hour", label: "Fin (heure)" },
      { key: "xp.night.timezone", label: "Fuseau horaire" },
      { key: "xp.night.message_multiplier", label: "Multiplicateur écrit" },
      { key: "xp.night.voice_multiplier", label: "Multiplicateur vocal" },
    ],
  },
  {
    id: "sleepcall",
    title: "Sleepcall",
    icon: Horloge,
    hint: "La nuit, un vocal à plusieurs devient un sleepcall : son multiplicateur remplace celui de nuit, et micro ou casque coupés gagnent le gain entier. Annonces : modèles sleepcall_start et sleepcall_end.",
    fields: [
      { key: "xp.sleepcall.enabled", label: "Sleepcall" },
      { key: "xp.sleepcall.min_members", label: "Membres présents requis" },
      { key: "xp.sleepcall.multiplier", label: "Multiplicateur sleepcall" },
      { key: "xp.sleepcall.announce", label: "Annoncer début et bilan" },
      { key: "xp.sleepcall.grace_minutes", label: "Creux toléré (minutes)" },
      { key: "xp.sleepcall.summary_min_minutes", label: "Durée minimale du bilan (minutes)" },
    ],
  },
  {
    id: "boosts",
    title: "Boosters, fusion et Zenkai",
    icon: Eclair,
    hint: "Boost booster et rôles boostés ne se cumulent pas : le plus fort s'applique. Le plafond borne le produit de tous les multiplicateurs.",
    fields: [
      { key: "xp.boost.boosters", label: "Multiplicateur booster serveur" },
      { key: "xp.fusion.bonus_ratio", label: "Part reversée au partenaire de fusion" },
      { key: "xp.zenkai.multiplier", label: "Multiplicateur Zenkai" },
      { key: "xp.zenkai.minutes", label: "Durée du Zenkai (minutes)" },
      { key: "xp.multiplier.max", label: "Plafond du multiplicateur cumulé" },
    ],
  },
  {
    id: "races",
    title: "Races",
    icon: Couronne,
    hint: "Le texte des avantages affiché par /race n'est pas recalculé : à reprendre si ces valeurs changent.",
    fields: [
      ...RACE_OPTIONS.flatMap((r) => [
        { key: `xp.race.${r.id}.message`, label: `${r.label} · XP écrit` },
        { key: `xp.race.${r.id}.voice`, label: `${r.label} · XP vocal` },
        { key: `race.${r.id}.zeni`, label: `${r.label} · zénis` },
        { key: `race.${r.id}.game_zeni`, label: `${r.label} · zénis de jeux` },
      ]),
      { key: "race.regen.xp", label: "Régén Namek · XP" },
      { key: "race.regen.zeni", label: "Régén Namek · zénis" },
      { key: "race.regen.hours", label: "Régén Namek · intervalle (heures)" },
    ],
  },
  {
    id: "zeni",
    title: "Zénis",
    icon: Piece,
    hint: "Récompenses d'activité en zénis.",
    fields: [
      { key: "zeni.daily_quest", label: "Quête quotidienne" },
      { key: "zeni.per_level", label: "Bonus par montée de niveau" },
      { key: "zeni.fusion.bonus_ratio", label: "Part reversée au partenaire de fusion" },
      { key: "zeni.game.win", label: "Victoire à un mini-jeu" },
      { key: "zeni.game.loss_penalty", label: "Pénalité de défaite" },
      { key: "zeni.message_chance", label: "Chance de drop par message" },
      { key: "zeni.message_drop_min", label: "Drop minimum" },
      { key: "zeni.message_drop_max", label: "Drop maximum" },
    ],
  },
];

const XP_BOOST_ROLE_PREFIX = "xp.boost.role.";
const tuningInput =
  "w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-white";

function XpTuningCard({
  config,
  loading,
}: {
  config: ConfigResponse | undefined;
  loading: boolean;
}) {
  const qc = useQueryClient();
  const schema = useQuery({
    queryKey: ["settings", "schema"],
    queryFn: () => api.get<{ keys: SettingSchema[] }>("/settings/schema"),
    staleTime: 5 * 60_000,
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["levels", "config"] });
    void qc.invalidateQueries({ queryKey: ["settings"] });
  };
  const dropDrafts = (keys: string[]) =>
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k))));

  const save = useMutation({
    mutationFn: async (entries: [string, string][]) => {
      for (const [key, value] of entries) await api.post("/services/settings/set", { key, value });
    },
    onSuccess: (_, entries) => {
      setErr(null);
      dropDrafts(entries.map(([k]) => k));
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Échec de l'enregistrement."),
    onSettled: refresh,
  });
  const reset = useMutation({
    mutationFn: (key: string) => api.post("/services/settings/unset", { key }),
    onSuccess: (_, key) => {
      setErr(null);
      dropDrafts([key]);
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Échec de la remise à zéro."),
    onSettled: refresh,
  });

  if (loading || schema.isLoading)
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-800 p-4 text-zinc-500">
        <Chargement className="h-4 w-4 animate-spin" />
        Chargement de la configuration…
      </div>
    );
  if (!config) return null;

  const defs = new Map((schema.data?.keys ?? []).map((k) => [k.key, k]));
  const saved = (key: string) => {
    const raw = config.overrides[key] ?? config.defaults[key] ?? defs.get(key)?.default;
    const value = raw === undefined ? "" : String(raw);
    return defs.get(key)?.type === "bool" ? String(/^(true|1)$/i.test(value)) : value;
  };
  const read = (key: string) => drafts[key] ?? saved(key);
  const pending = save.isPending || reset.isPending;

  return (
    <div className="card">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        <Eclair className="h-4 w-4" />
        Gains, bonus et multiplicateurs d&apos;XP
      </h3>
      <p className="mb-3 text-xs text-zinc-500">
        Chaque valeur s&apos;applique au gain suivant (cache du bot : 30 s). Une valeur
        personnalisée se remet au défaut d&apos;un clic. Les membres voient leurs multiplicateurs
        avec <code>/boosts</code> sur Discord.
      </p>

      <XpSimulation read={read} />

      <div className="space-y-3">
        {TUNING_SECTIONS.map((section) => {
          const Icon = section.icon;
          const dirty = section.fields.filter(
            (f) => drafts[f.key] !== undefined && drafts[f.key] !== saved(f.key),
          );
          return (
            <section
              key={section.id}
              className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <Icon className="h-4 w-4 text-brand-400" />
                {section.title}
              </div>
              <p className="mb-3 mt-0.5 text-xs text-zinc-500">{section.hint}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {section.fields.map((f) => {
                  const def = defs.get(f.key);
                  const overridden = config.overrides[f.key] !== undefined;
                  const onChange = (v: string) => setDrafts((d) => ({ ...d, [f.key]: v }));
                  return (
                    <div
                      key={f.key}
                      className="rounded-lg border border-zinc-800 p-2"
                      title={def?.description}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-zinc-400">
                        <label htmlFor={f.key}>{f.label}</label>
                        {overridden && (
                          <button
                            type="button"
                            onClick={() => reset.mutate(f.key)}
                            disabled={pending}
                            title="Revenir à la valeur par défaut"
                            className="inline-flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 disabled:opacity-40"
                          >
                            <Reinitialiser className="h-3 w-3" />
                            personnalisé
                          </button>
                        )}
                      </div>
                      {def?.type === "bool" ? (
                        <select
                          id={f.key}
                          className={tuningInput}
                          value={read(f.key)}
                          onChange={(e) => onChange(e.target.value)}
                        >
                          <option value="true">Activé</option>
                          <option value="false">Désactivé</option>
                        </select>
                      ) : (
                        <input
                          id={f.key}
                          className={tuningInput}
                          type={def?.type === "int" || def?.type === "float" ? "number" : "text"}
                          step={def?.type === "float" ? "0.05" : "1"}
                          min={def?.min}
                          max={def?.max}
                          value={read(f.key)}
                          onChange={(e) => onChange(e.target.value)}
                        />
                      )}
                      <p className="mt-1 text-[10px] text-zinc-600">
                        défaut : {def?.default === undefined ? "—" : String(def.default)}
                        {def?.min !== undefined && ` · de ${def.min} à ${def.max ?? "∞"}`}
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={dirty.length === 0 || pending}
                  onClick={() => save.mutate(dirty.map((f) => [f.key, drafts[f.key]!]))}
                  className="inline-flex items-center gap-1 rounded bg-brand-600 px-3 py-1 text-xs font-bold text-white hover:bg-brand-500 disabled:opacity-40"
                >
                  <Enregistrer className="h-3.5 w-3.5" />
                  {save.isPending
                    ? "Enregistrement…"
                    : `Enregistrer${dirty.length ? ` (${dirty.length})` : ""}`}
                </button>
                {dirty.length > 0 && !pending && (
                  <button
                    type="button"
                    onClick={() => dropDrafts(section.fields.map((f) => f.key))}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Annuler
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <XpRoleBoostEditor overrides={config.overrides} onChanged={refresh} />
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}

/**
 * Gains types calculés sur les valeurs affichées, brouillons compris, hors rôle
 * et race. Même formule que le bot (lib/xp-boosts.ts) : base × min(plafond,
 * groupe × nuit ou sleepcall) × part du statut micro.
 */
function XpSimulation({ read }: { read: (key: string) => string }) {
  const n = (key: string) => {
    const v = Number(read(key));
    return Number.isFinite(v) ? v : 0;
  };
  const on = (key: string) => read(key) === "true";
  const perMinute = n("xp.voice.per_minute");
  const cap = Math.max(1, n("xp.multiplier.max"));
  const minMembers = Math.max(1, n("xp.voice.min_members"));
  const group = (members: number) =>
    Math.min(
      Math.max(1, n("xp.voice.group.max_multiplier")),
      1 + n("xp.voice.group.bonus_per_member") * Math.max(0, members - 1),
    );
  const voice = (members: number, mult: number, share: number) =>
    members < minMembers || share <= 0
      ? 0
      : Math.floor(perMinute * Math.min(cap, group(members) * mult) * share);
  const night = on("xp.night.enabled");
  const nightVoice = night ? n("xp.night.voice_multiplier") : 1;
  const sleepcall = night && on("xp.sleepcall.enabled");
  const sleepMembers = Math.max(2, n("xp.sleepcall.min_members"));
  const cooldown = n("xp.message.cooldown_ms");
  const perMessage = (n("xp.message.min") + n("xp.message.max")) / 2;
  const messagesPerHour = cooldown > 0 ? 3_600_000 / cooldown : 0;

  const cases = [
    {
      label: "Seul en journée, micro ouvert",
      value: `${voice(1, 1, 1).toLocaleString("fr-FR")} XP/min`,
    },
    {
      label: "À 4 en journée, micro coupé",
      value: `${voice(4, 1, Math.min(1, n("xp.voice.muted_ratio"))).toLocaleString("fr-FR")} XP/min`,
    },
    {
      label: "Seul la nuit, casque coupé",
      value: `${voice(1, nightVoice, Math.min(1, n("xp.voice.deafened_ratio"))).toLocaleString("fr-FR")} XP/min`,
    },
    {
      label: `Sleepcall à ${sleepMembers}, casques coupés`,
      value: sleepcall
        ? `${voice(sleepMembers, n("xp.sleepcall.multiplier"), 1).toLocaleString("fr-FR")} XP/min`
        : "désactivé",
    },
    {
      label: "Écrit en continu, journée",
      value: messagesPerHour
        ? `${Math.floor(perMessage * messagesPerHour).toLocaleString("fr-FR")} XP/h`
        : "à chaque message",
    },
    {
      label: "Écrit en continu, nuit",
      value: messagesPerHour
        ? `${Math.floor(perMessage * messagesPerHour * Math.min(cap, night ? n("xp.night.message_multiplier") : 1)).toLocaleString("fr-FR")} XP/h`
        : "à chaque message",
    },
  ];

  return (
    <div className="mb-3 rounded-lg border border-zinc-800 p-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
        Simulation hors rôle et race
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {cases.map((c) => (
          <div key={c.label} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-zinc-400">{c.label}</span>
            <span className="font-mono font-bold text-brand-400">{c.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function XpRoleBoostEditor({
  overrides,
  onChanged,
}: {
  overrides: Record<string, string>;
  onChanged: () => void;
}) {
  const [roleId, setRoleId] = useState("");
  const [multiplier, setMultiplier] = useState("1.5");
  const [err, setErr] = useState<string | null>(null);
  const entries = Object.entries(overrides)
    .filter(([k]) => k.startsWith(XP_BOOST_ROLE_PREFIX))
    .map(([k, v]) => ({ roleId: k.slice(XP_BOOST_ROLE_PREFIX.length), multiplier: v }))
    .toSorted((a, b) => Number(b.multiplier) - Number(a.multiplier));

  const set = useMutation({
    mutationFn: (e: { roleId: string; multiplier: string }) =>
      api.post("/services/settings/set", {
        key: `${XP_BOOST_ROLE_PREFIX}${e.roleId}`,
        value: e.multiplier,
      }),
    onSuccess: () => setErr(null),
    onError: (e) => setErr(e instanceof Error ? e.message : "Échec de l'enregistrement."),
    onSettled: onChanged,
  });
  const unset = useMutation({
    mutationFn: (id: string) =>
      api.post("/services/settings/unset", { key: `${XP_BOOST_ROLE_PREFIX}${id}` }),
    onError: (e) => setErr(e instanceof Error ? e.message : "Échec de la suppression."),
    onSettled: onChanged,
  });

  return (
    <details className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-200">
        Rôles boostés ({entries.length})
      </summary>
      <p className="mb-3 mt-1 text-xs text-zinc-500">
        Multiplicateur par rôle. Un membre qui porte plusieurs rôles boostés prend le plus fort,
        sans cumul avec le boost booster.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map((e) => (
          <div
            key={e.roleId}
            className="flex items-center gap-2 rounded border border-zinc-800 px-2 py-1"
          >
            <span className="min-w-0 flex-1 truncate text-xs">
              <RoleBadge roleId={e.roleId} />
            </span>
            <input
              type="number"
              step="0.05"
              min="0.05"
              defaultValue={e.multiplier}
              aria-label="Multiplicateur"
              onBlur={(ev) => {
                if (ev.target.value && ev.target.value !== e.multiplier)
                  set.mutate({ roleId: e.roleId, multiplier: ev.target.value });
              }}
              className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-white"
            />
            <button
              type="button"
              onClick={() => unset.mutate(e.roleId)}
              disabled={unset.isPending}
              title="Retirer le boost de ce rôle"
              className="rounded p-1 text-red-400 hover:text-red-300"
            >
              <Corbeille className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_6rem_auto]">
        <RoleSelect value={roleId} onChange={setRoleId} />
        <input
          type="number"
          step="0.05"
          min="0.05"
          value={multiplier}
          onChange={(e) => setMultiplier(e.target.value)}
          aria-label="Multiplicateur du nouveau rôle"
          className={tuningInput}
        />
        <button
          type="button"
          disabled={!roleId || !multiplier || set.isPending}
          onClick={() => {
            set.mutate({ roleId, multiplier });
            setRoleId("");
            setMultiplier("1.5");
          }}
          className="inline-flex items-center justify-center gap-1 rounded bg-brand-600 px-3 py-1 text-xs font-bold text-white hover:bg-brand-500 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Ajouter
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </details>
  );
}

interface Threshold {
  level: number;
  xp: number;
}

/**
 * Éditeur de la COURBE DE NIVEAUX (paliers XP → niveau). Modifie la table active
 * côté bot (guild_settings.xp.thresholds) : ajout/suppression de paliers (jusqu'à
 * 50), XP par niveau. La progression de TOUS les joueurs s'y recale à chaud.
 */
function ThresholdCurveCard() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["levels", "thresholds"],
    queryFn: () => api.get<{ thresholds: Threshold[] }>("/levels/thresholds"),
  });
  const [rows, setRows] = useState<Threshold[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Hydrate l'état local depuis la DB une fois chargé (ou après reset).
  const serverRows = query.data?.thresholds;
  const current = rows ?? serverRows ?? [];

  const save = useMutation({
    mutationFn: (next: Threshold[]) =>
      api.put<{ ok: boolean; thresholds: Threshold[] }>("/levels/thresholds", { thresholds: next }),
    onSuccess: (res) => {
      setErr(null);
      setRows(res.thresholds);
      void qc.invalidateQueries({ queryKey: ["levels"] });
      void qc.invalidateQueries({ queryKey: ["levels", "config"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Échec de l'enregistrement."),
  });

  function edit(i: number, field: keyof Threshold, value: number) {
    setRows(current.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  }
  function addRow() {
    const maxLevel = current.reduce((m, r) => Math.max(m, r.level), 0);
    const maxXp = current.reduce((m, r) => Math.max(m, r.xp), 0);
    setRows([...current, { level: maxLevel + 1, xp: maxXp * 2 || 1000 }]);
  }
  function removeRow(i: number) {
    setRows(current.filter((_, j) => j !== i));
  }

  const dirty = JSON.stringify(current) !== JSON.stringify(serverRows ?? []);

  return (
    <div className="card">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        <Tendance className="h-4 w-4" />
        Courbe de niveaux — paliers XP éditables
      </h3>
      <p className="mb-3 text-xs text-zinc-500">
        Définissez l&apos;XP requis pour chaque niveau. La progression de tous les joueurs se recale
        immédiatement (recalcul du niveau + rôles de palier au prochain gain d&apos;XP).
        Jusqu&apos;à 50 paliers ; l&apos;XP doit croître avec le niveau.
      </p>

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Chargement className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-3 px-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            <span className="w-20">Niveau</span>
            <span className="flex-1">XP requis</span>
            <span className="w-8" />
          </div>
          {current
            .slice()
            .toSorted((a, b) => a.level - b.level)
            .map((t) => {
              const idx = current.indexOf(t);
              return (
                <div key={idx} className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    value={t.level}
                    onChange={(e) => edit(idx, "level", Number(e.target.value))}
                    className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-white"
                  />
                  <input
                    type="number"
                    min={0}
                    value={t.xp}
                    onChange={(e) => edit(idx, "xp", Number(e.target.value))}
                    className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-white"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    title="Supprimer ce palier"
                    className="w-8 rounded p-1 text-red-400 hover:text-red-300"
                  >
                    <Corbeille className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-brand-500"
            >
              <Plus className="h-3.5 w-3.5" /> Ajouter un palier
            </button>
            <button
              type="button"
              disabled={!dirty || save.isPending || current.length === 0}
              onClick={() => save.mutate(current)}
              className="inline-flex items-center gap-1 rounded bg-brand-600 px-3 py-1 text-xs font-bold text-white hover:bg-brand-500 disabled:opacity-40"
            >
              <Enregistrer className="h-3.5 w-3.5" />
              {save.isPending ? "Enregistrement…" : "Enregistrer la courbe"}
            </button>
            {dirty && !save.isPending && (
              <button
                type="button"
                onClick={() => {
                  setRows(null);
                  setErr(null);
                }}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Annuler
              </button>
            )}
            {save.isSuccess && !dirty && (
              <span className="text-xs text-green-400">Enregistré ✓</span>
            )}
          </div>
          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>
      )}
    </div>
  );
}

function ThresholdsCard({
  config,
  distribution,
  loading,
}: {
  config: ConfigResponse | undefined;
  distribution: DistributionBucket[] | undefined;
  loading: boolean;
}) {
  if (!config) return null;
  const total = (distribution ?? []).reduce((s, b) => s + b.count, 0);
  const max = Math.max(...(distribution ?? [{ count: 1 }]).map((b) => b.count), 1);

  return (
    <div className="card">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        <Tendance className="h-4 w-4" />
        Paliers DBZ — répartition des joueurs
      </h3>
      <p className="mb-3 text-xs text-zinc-500">
        Chaque barre représente le nombre de joueurs dans ce palier d&apos;XP. Total :{" "}
        <strong>
          {total} joueur{total !== 1 ? "s" : ""}
        </strong>{" "}
        enregistré{total !== 1 ? "s" : ""}.
      </p>
      {loading && (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Chargement className="h-4 w-4 animate-spin" />
          Chargement de la distribution…
        </div>
      )}
      <div className="space-y-2">
        {config.thresholds.map((t, i) => {
          const bucket = distribution?.find((b) => b.level === t.level);
          const minXp = i === 0 ? 0 : config.thresholds[i - 1]!.xp;
          const count = bucket?.count ?? 0;
          return (
            <div key={t.level} className="flex items-center gap-3">
              <span className="w-20 font-mono text-xs text-zinc-400">niveau {t.level}</span>
              <span className="w-32 text-right font-mono text-xs text-zinc-500">
                {minXp.toLocaleString("fr-FR")} – {t.xp.toLocaleString("fr-FR")}
              </span>
              <div className="relative h-5 flex-1 overflow-hidden rounded bg-zinc-800">
                <div
                  className="h-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all"
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </div>
              <span className="w-20 text-right font-mono text-xs">
                {count} joueur{count !== 1 ? "s" : ""}
              </span>
            </div>
          );
        })}
        {distribution?.find((b) => b.level === 11)?.count ? (
          <div className="flex items-center gap-3">
            <span className="w-20 font-mono text-xs text-amber-400">au-delà</span>
            <span className="w-32 text-right font-mono text-xs text-zinc-500">&gt; 9 000 000</span>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all"
                style={{
                  width: `${((distribution?.find((b) => b.level === 11)?.count ?? 0) / max) * 100}%`,
                }}
              />
            </div>
            <span className="w-20 text-right font-mono text-xs text-amber-400">
              {distribution?.find((b) => b.level === 11)?.count}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RewardsCard({ rewards, loading }: { rewards: LevelReward[]; loading: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<LevelReward | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<LevelReward | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const upsert = useMutation({
    // Changer le NIVEAU d'une récompense, c'est changer sa clé : le bot ne sait
    // qu'écrire (upsert) ou supprimer par niveau. On écrit la nouvelle entrée PUIS
    // on retire l'ancienne — dans cet ordre, un échec entre les deux laisse un
    // doublon visible plutôt qu'une récompense perdue.
    mutationFn: async ({
      reward: r,
      ancienNiveau,
    }: {
      reward: LevelReward;
      ancienNiveau?: number;
    }) => {
      await api.post("/levels/rewards", {
        level: r.level,
        roleId: r.roleId,
        xpThreshold: r.xpThreshold,
        zeniBonus: r.zeniBonus,
      });
      if (ancienNiveau != null && ancienNiveau !== r.level) {
        await api.delete(`/levels/rewards/${ancienNiveau}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["levels", "rewards"] });
      setEditing(null);
      setAdding(false);
      showSuccess("Récompense enregistrée avec succès.");
    },
  });

  const remove = useMutation({
    mutationFn: (level: number) => api.delete(`/levels/rewards/${level}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["levels", "rewards"] });
      showSuccess("Récompense supprimée.");
    },
  });

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Récompenses de palier ({rewards.length})
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Rôles et bonus zénis attribués automatiquement à chaque montée de niveau.
          </p>
        </div>
        <button type="button" onClick={() => setAdding(true)} className="btn btn-primary">
          <Plus className="h-3 w-3" />
          Ajouter une récompense
        </button>
      </div>

      {successMsg && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          <CocheCercle className="h-4 w-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Supprimer la récompense du niveau ${confirmDelete.level} ?`}
          message="Cette récompense ne sera plus attribuée lors des prochaines montées de niveau. Les rôles déjà attribués aux joueurs ne seront pas retirés."
          confirmLabel="Supprimer définitivement"
          onConfirm={() => {
            remove.mutate(confirmDelete.level);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Chargement className="h-4 w-4 animate-spin" />
          Chargement des récompenses…
        </div>
      ) : rewards.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-4 text-center text-sm text-zinc-500">
          Aucune récompense de palier définie pour le moment.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left">Niveau</th>
                <th className="px-3 py-2 text-left">Rôle Discord attribué</th>
                <th className="px-3 py-2 text-right">Seuil XP requis</th>
                <th className="px-3 py-2 text-right">Bonus zénis</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rewards.map((r) => (
                <tr key={r.level}>
                  <td className="px-3 py-2 font-bold text-brand-400">{r.level}</td>
                  <td className="px-3 py-2 text-sm">
                    <RoleBadge roleId={r.roleId} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {r.xpThreshold.toLocaleString("fr-FR")}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-amber-400">
                    +{r.zeniBonus.toLocaleString("fr-FR")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(r)}
                        className="btn btn-ghost px-2"
                        title="Modifier cette récompense"
                      >
                        <Enregistrer className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(r)}
                        className="btn btn-ghost px-2 text-red-400"
                        title="Supprimer cette récompense"
                      >
                        <Corbeille className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(editing || adding) && (
        <RewardForm
          initial={editing ?? undefined}
          niveauxPris={rewards.map((r) => r.level)}
          onSubmit={(r) => upsert.mutate({ reward: r, ancienNiveau: editing?.level })}
          onCancel={() => {
            setEditing(null);
            setAdding(false);
          }}
          pending={upsert.isPending}
          error={upsert.isError ? (upsert.error as Error).message : null}
        />
      )}
    </div>
  );
}

function RewardForm({
  initial,
  niveauxPris,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  initial?: LevelReward;
  /** Niveaux déjà dotés d'une récompense — pour ne pas en écraser un en silence. */
  niveauxPris: number[];
  onSubmit: (r: LevelReward) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const [level, setLevel] = useState(String(initial?.level ?? ""));
  const [roleId, setRoleId] = useState(initial?.roleId ?? "");
  const [xpThreshold, setXpThreshold] = useState(String(initial?.xpThreshold ?? ""));
  const [zeniBonus, setZeniBonus] = useState(String(initial?.zeniBonus ?? "1000"));
  const [conflit, setConflit] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cible = Number(level);
    if (niveauxPris.includes(cible) && cible !== initial?.level) {
      setConflit(
        `Le niveau ${cible} a déjà une récompense : modifie-la directement plutôt que de l'écraser.`,
      );
      return;
    }
    setConflit(null);
    onSubmit({
      level: Number(level),
      roleId,
      xpThreshold: Number(xpThreshold),
      zeniBonus: Number(zeniBonus),
    });
  };

  return (
    <form
      onSubmit={submit}
      className="mt-3 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
    >
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {initial ? "Modifier la récompense" : "Nouvelle récompense"}
      </h4>
      {(conflit ?? error) && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
          {conflit ?? error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Niveau</label>
          <input
            className="input"
            type="number"
            min="1"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-3">
          <label className="mb-1 block text-xs text-zinc-400">Rôle Discord à attribuer</label>
          <RolePicker value={roleId} onChange={setRoleId} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Seuil XP requis</label>
          <input
            className="input"
            type="number"
            min="0"
            value={xpThreshold}
            onChange={(e) => setXpThreshold(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Bonus zénis offerts</label>
          <input
            className="input"
            type="number"
            min="0"
            value={zeniBonus}
            onChange={(e) => setZeniBonus(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost">
          Annuler
        </button>
        <button type="submit" disabled={pending} className="btn btn-primary">
          <Enregistrer className="h-3 w-3" />
          {pending ? "Enregistrement…" : "Enregistrer la récompense"}
        </button>
      </div>
    </form>
  );
}

function RaceRewardsCard({ rewards, loading }: { rewards: RaceReward[]; loading: boolean }) {
  const qc = useQueryClient();
  const [race, setRace] = useState<string>(RACE_OPTIONS[0]!.id);
  const [level, setLevel] = useState("");
  const [roleId, setRoleId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<RaceReward | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // Palier en cours de modification (sa clé d'origine : race + niveau).
  const [editing, setEditing] = useState<RaceReward | null>(null);
  const [conflit, setConflit] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const upsert = useMutation({
    // Même règle que pour les récompenses : on écrit la nouvelle clé, PUIS on
    // retire l'ancienne si la race ou le niveau a changé.
    mutationFn: async ({
      entree,
      ancienne,
    }: {
      entree: RaceReward;
      ancienne: RaceReward | null;
    }) => {
      await api.post("/levels/race-rewards", entree);
      if (ancienne && (ancienne.race !== entree.race || ancienne.level !== entree.level)) {
        await api.delete(`/levels/race-rewards/${ancienne.race}/${ancienne.level}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["levels", "race-rewards"] });
      setEditing(null);
      setLevel("");
      setRoleId("");
      showSuccess("Rôle de palier enregistré avec succès.");
    },
  });

  const existe = (ra: string, lv: number) => rewards.some((r) => r.race === ra && r.level === lv);

  const modifier = (r: RaceReward) => {
    setEditing(r);
    setRace(r.race);
    setLevel(String(r.level));
    setRoleId(r.roleId);
    setConflit(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const annuler = () => {
    setEditing(null);
    setLevel("");
    setRoleId("");
    setConflit(null);
  };

  const remove = useMutation({
    mutationFn: (r: RaceReward) => api.delete(`/levels/race-rewards/${r.race}/${r.level}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["levels", "race-rewards"] });
      showSuccess("Rôle de palier supprimé.");
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const lv = Number(level);
    const memeCle = editing != null && editing.race === race && editing.level === lv;
    if (editing && !memeCle && existe(race, lv)) {
      setConflit(`Le palier ${lv} (${raceLabel(race)}) existe déjà — modifie-le directement.`);
      return;
    }
    setConflit(null);
    upsert.mutate({ entree: { race, level: lv, roleId }, ancienne: editing });
  };
  // Hors édition, saisir une race et un niveau déjà configurés REMPLACE le rôle :
  // le bouton le dit, au lieu d'un « Ajouter » qui laissait croire à un doublon.
  const remplace = !editing && level !== "" && existe(race, Number(level));

  // Regroupe par race (dans l'ordre canonique) puis trie par niveau.
  const grouped = RACE_OPTIONS.map((opt) => ({
    ...opt,
    rows: rewards.filter((r) => r.race === opt.id).toSorted((a, b) => a.level - b.level),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="card">
      <div className="mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Rôles de palier par race ({rewards.length})
        </h3>
        <p className="mt-0.5 text-xs text-zinc-500">
          Rôle de transformation attribué à chaque montée de palier, propre à chaque race.
          C&apos;est cette table qui pilote les rôles distribués lors des level-up (indépendante des
          bonus zénis ci-dessus). Une race sans palier configuré ne reçoit ni ne perd aucun rôle de
          transformation.
        </p>
      </div>

      {successMsg && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          <CocheCercle className="h-4 w-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Supprimer le palier ${confirmDelete.level} (${raceLabel(confirmDelete.race)}) ?`}
          message="Ce rôle ne sera plus attribué lors des prochaines montées de niveau pour cette race. Les rôles déjà attribués aux joueurs ne seront pas retirés."
          confirmLabel="Supprimer définitivement"
          onConfirm={() => {
            remove.mutate(confirmDelete);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <form
        ref={formRef}
        onSubmit={submit}
        className="mb-4 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
      >
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {editing
            ? `Modifier le palier ${editing.level} (${raceLabel(editing.race)})`
            : "Ajouter / modifier un palier de race"}
        </h4>
        {conflit && (
          <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
            {conflit}
          </div>
        )}
        {upsert.isError && (
          <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
            {(upsert.error as Error).message}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Race</label>
            <select className="input" value={race} onChange={(e) => setRace(e.target.value)}>
              {RACE_OPTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Niveau (palier)</label>
            <input
              className="input"
              type="number"
              min="1"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-zinc-400">Rôle Discord à attribuer</label>
            <RolePicker value={roleId} onChange={setRoleId} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          {editing && (
            <button type="button" onClick={annuler} className="btn btn-ghost">
              Annuler
            </button>
          )}
          <button
            type="submit"
            disabled={!level || !roleId || upsert.isPending}
            className="btn btn-primary"
          >
            {editing ? <Enregistrer className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {upsert.isPending
              ? "Enregistrement…"
              : editing
                ? "Enregistrer"
                : remplace
                  ? "Remplacer"
                  : "Ajouter"}
          </button>
        </div>
      </form>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Chargement className="h-4 w-4 animate-spin" />
          Chargement des paliers…
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-4 text-center text-sm text-zinc-500">
          Aucun rôle de palier configuré pour le moment.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => (
            <div key={g.id}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-400">
                {g.label} ({g.rows.length})
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Palier</th>
                      <th className="px-3 py-2 text-left">Rôle Discord attribué</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {g.rows.map((r) => (
                      <tr
                        key={`${r.race}-${r.level}`}
                        className={
                          editing?.race === r.race && editing?.level === r.level
                            ? "bg-zinc-800/60"
                            : undefined
                        }
                      >
                        <td className="px-3 py-2 font-bold text-brand-400">{r.level}</td>
                        <td className="px-3 py-2 text-sm">
                          <RoleBadge roleId={r.roleId} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => modifier(r)}
                              className="btn btn-ghost px-2"
                              title="Modifier ce palier"
                            >
                              <Enregistrer className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(r)}
                              className="btn btn-ghost px-2 text-red-400"
                              title="Supprimer ce palier"
                            >
                              <Corbeille className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopsCard() {
  const [metric, setMetric] = useState<Metric>("xp");
  const [limit, setLimit] = useState(10);
  const top = useQuery({
    queryKey: ["levels", "top", metric, limit],
    queryFn: () => api.get<{ users: TopUser[] }>(`/levels/top?metric=${metric}&limit=${limit}`),
  });

  const formatMetric = (u: TopUser): string => {
    switch (metric) {
      case "voice":
        return formatDuration(u.totalVoiceMs);
      case "streak":
        return `${u.dailyStreak} jour${u.dailyStreak !== 1 ? "s" : ""}`;
      case "messages":
        return `${u.messageCount.toLocaleString("fr-FR")} messages`;
      case "zeni":
        return formatZeni(u.zeni);
      default:
        return `${u.xp.toLocaleString("fr-FR")} XP`;
    }
  };

  const metrics = [
    { k: "xp" as Metric, label: "XP" },
    { k: "zeni" as Metric, label: "Zénis" },
    { k: "voice" as Metric, label: "Temps vocal" },
    { k: "messages" as Metric, label: "Messages" },
    { k: "streak" as Metric, label: "Streak quête" },
  ] as const;

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Classement rapide
        </h3>
        <div className="flex flex-wrap gap-1">
          {metrics.map((m) => (
            <button
              key={m.k}
              type="button"
              onClick={() => setMetric(m.k)}
              className={`btn ${metric === m.k ? "btn-primary" : "btn-ghost"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <select
          className="input ml-auto w-32"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        >
          {[10, 25, 50].map((n) => (
            <option key={n} value={n}>
              Top {n}
            </option>
          ))}
        </select>
      </div>

      {top.isLoading && (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Chargement className="h-4 w-4 animate-spin" />
          Chargement du classement…
        </div>
      )}
      {top.isError && (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <Alerte className="h-4 w-4" />
          Impossible de charger le classement. Réessayez.
        </div>
      )}

      <div className="space-y-1.5">
        {top.data?.users.map((u, i) => (
          <div key={u.id} className="flex items-center gap-3 text-sm">
            <span className="w-8 text-right font-mono text-xs text-zinc-500">#{i + 1}</span>
            <span className="w-44 truncate font-mono text-xs text-zinc-300" title={u.id}>
              {u.id.slice(0, 6)}…{u.id.slice(-4)}
              <span
                className="ml-1 text-[10px] text-zinc-600"
                title={`ID Discord complet : ${u.id}`}
              >
                ({u.id})
              </span>
            </span>
            <span className="flex-1 truncate text-xs text-zinc-400">
              niveau {u.lastLevelReached} · {u.xp.toLocaleString("fr-FR")} XP · {formatZeni(u.zeni)}
            </span>
            <span className="text-right font-mono text-sm text-brand-400">{formatMetric(u)}</span>
          </div>
        ))}
        {top.data?.users.length === 0 && (
          <p className="text-sm italic text-zinc-500">
            Aucun joueur enregistré pour cette métrique.
          </p>
        )}
      </div>
    </div>
  );
}

function ManualActionsCard() {
  const [userId, setUserId] = useState("");
  const [target, setTarget] = useState<"xp" | "zeni">("xp");
  const [mode, setMode] = useState<"add" | "set">("add");
  const [amount, setAmount] = useState("");
  const [lastResult, setLastResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/levels/users/${userId}/${target}`, {
        mode,
        amount: Number(amount),
      }),
    onSuccess: (data) => {
      const d = data as {
        ok?: boolean;
        newXp?: number;
        newZeni?: number;
        previousXp?: number;
        previousZeni?: number;
      };
      const newVal = target === "xp" ? d.newXp : d.newZeni;
      setLastResult({
        ok: true,
        msg: `Modification appliquée. Nouvelle valeur : ${newVal?.toLocaleString("fr-FR") ?? "—"} ${target === "xp" ? "XP" : "zénis"}.`,
      });
    },
    onError: (err) =>
      setLastResult({
        ok: false,
        msg: `Erreur : ${err instanceof Error ? err.message : String(err)}`,
      }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLastResult(null);
    mutation.mutate();
  };

  return (
    <form onSubmit={submit} className="card space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Modification manuelle d&apos;un joueur
      </h3>
      <p className="text-xs text-zinc-500">
        Permet d&apos;ajouter, retirer ou définir directement l&apos;XP ou les zénis d&apos;un
        membre. Renseignez son identifiant Discord (suite de chiffres visible dans les paramètres
        Discord avec le mode développeur activé).
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="mb-1 block text-xs text-zinc-400">Identifiant Discord du joueur</label>
          <UserSelect value={userId} onChange={setUserId} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Ce que l&apos;on modifie</label>
          <select
            className="input"
            value={target}
            onChange={(e) => setTarget(e.target.value as "xp" | "zeni")}
          >
            <option value="xp">Points d&apos;expérience (XP)</option>
            <option value="zeni">Zénis (monnaie)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Opération</label>
          <select
            className="input"
            value={mode}
            onChange={(e) => setMode(e.target.value as "add" | "set")}
          >
            <option value="add">Ajouter / retirer</option>
            <option value="set">Définir exactement</option>
          </select>
        </div>
        <div className="lg:col-span-2">
          <label className="mb-1 block text-xs text-zinc-400">Montant (négatif pour retirer)</label>
          <input
            className="input"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={mode === "add" ? "ex. 1000 ou -500" : "ex. 50000"}
            required
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={!userId || !amount || mutation.isPending}
        className="btn btn-primary"
      >
        <Enregistrer className="h-3 w-3" />
        {mutation.isPending ? "Application en cours…" : "Appliquer la modification"}
      </button>
      {lastResult && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            lastResult.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/40 bg-red-500/10 text-red-400"
          }`}
        >
          {lastResult.ok ? (
            <CocheCercle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <Alerte className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {lastResult.msg}
        </div>
      )}
    </form>
  );
}
