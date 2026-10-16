"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Coins,
  Hash,
  MessageSquare,
  Power,
  Settings as SettingsIcon,
  Shield,
  ShieldAlert,
  Trash2,
  Trophy,
  Languages,
  Wrench,
  Ticket,
  Film,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import { ChannelSelect } from "@aphrody/admin-ui/components/admin/ChannelSelect";
import { RoleSelect } from "@aphrody/admin-ui/components/admin/RoleSelect";
import {
  JsonEditor,
  looksLikeJson,
} from "@aphrody/admin-ui/components/admin/JsonEditor";

interface SettingDef {
  key: string;
  type: "int" | "float" | "snowflake" | "string" | "bool";
  description: string;
  default?: unknown;
  min?: number;
  max?: number;
  category?: string;
  channelType?: "text" | "voice" | "category" | "any";
  prefix?: boolean;
}

interface CurrentSetting {
  key: string;
  value: string;
}

const CATEGORY_META: Record<
  string,
  { label: string; icon: React.ElementType; desc: string }
> = {
  xp: {
    label: "XP & niveaux",
    icon: Trophy,
    desc: "Gain d'XP par message, vocal, multipliers de rôle.",
  },
  economy: {
    label: "Économie",
    icon: Coins,
    desc: "Récompenses zenis, drops, bonus level-up.",
  },
  channels: {
    label: "Salons",
    icon: Hash,
    desc: "Mappage des salons par fonction (welcome, logs, etc.).",
  },
  roles: {
    label: "Rôles",
    icon: Shield,
    desc: "Rôles spéciaux : fusion, jail, bio.",
  },
  features: {
    label: "Fonctions",
    icon: Power,
    desc: "Activer / désactiver les modules du bot.",
  },
  moderation: {
    label: "Modération",
    icon: ShieldAlert,
    desc: "Seuils warns, durées par défaut.",
  },
  anti_invite: {
    label: "Anti-invitation",
    icon: MessageSquare,
    desc: "Détection de liens d'invitation Discord.",
  },
  translate: {
    label: "Traduction",
    icon: Languages,
    desc: "Endpoints traducteurs (Lingva, LibreTranslate).",
  },
  tickets: {
    label: "Tickets",
    icon: Ticket,
    desc: "Webhook de notification + nom d'affichage du webhook tickets.",
  },
  gifs: {
    label: "GIFs sanctions",
    icon: Film,
    desc: "Override des GIFs DBZ embed pour warn / mute / kick / ban / jail / purge / unjail / unban.",
  },
  advanced: {
    label: "Avancé",
    icon: Wrench,
    desc: "Préfixes dynamiques (xp.boost.role.<id>).",
  },
};

const TICKET_KINDS = ["report", "achat", "shop", "abus"] as const;
const TICKET_KIND_META: Record<
  (typeof TICKET_KINDS)[number],
  { emoji: string; label: string }
> = {
  report: { emoji: "🚨", label: "Signaler" },
  achat: { emoji: "🛒", label: "Achat" },
  shop: { emoji: "🏪", label: "Shop" },
  abus: { emoji: "⚠️", label: "Abus de perm" },
};
const TICKET_ACCESS_PREFIX = "tickets.access.";

const CATEGORY_ORDER = [
  "features",
  "channels",
  "roles",
  "xp",
  "economy",
  "moderation",
  "anti_invite",
  "translate",
  "tickets",
  "gifs",
  "advanced",
];

export default function SettingsPage() {
  const qc = useQueryClient();

  const schema = useQuery({
    queryKey: ["settings", "schema"],
    queryFn: () => api.get<{ keys: SettingDef[] }>("/settings/schema"),
    staleTime: 5 * 60_000,
  });

  const current = useQuery({
    queryKey: ["settings", "current"],
    queryFn: () =>
      api.get<{ rows: CurrentSetting[]; total?: number }>(
        "/database/guild_settings?limit=500",
      ),
  });

  const [toast, setToast] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const set = useMutation({
    mutationFn: (data: { key: string; value: string }) =>
      api.post("/services/settings/set", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setToast({ type: "success", msg: "Paramètre enregistré." });
    },
    onError: (err: Error) =>
      setToast({ type: "error", msg: `Échec : ${err.message}` }),
  });
  const unset = useMutation({
    mutationFn: (key: string) => api.post("/services/settings/unset", { key }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setToast({ type: "success", msg: "Retour à la valeur par défaut." });
    },
    onError: (err: Error) =>
      setToast({ type: "error", msg: `Échec : ${err.message}` }),
  });

  const valueMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of current.data?.rows ?? []) m.set(r.key, r.value);
    return m;
  }, [current.data]);

  const grouped = useMemo(() => {
    const all = schema.data?.keys ?? [];
    const byCat = new Map<string, SettingDef[]>();
    for (const k of all) {
      const cat = k.category ?? "advanced";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(k);
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
      category: c,
      keys: byCat.get(c)!,
    }));
  }, [schema.data]);

  const overriddenCount = current.data?.rows?.length ?? 0;
  const xpBoostRoles = useMemo(() => {
    const out: { roleId: string; multiplier: string }[] = [];
    for (const [k, v] of valueMap) {
      if (k.startsWith("xp.boost.role."))
        out.push({ roleId: k.slice(14), multiplier: v });
    }
    return out;
  }, [valueMap]);

  const ticketAccessRoles = useMemo(() => {
    const out: Record<string, string[]> = {
      report: [],
      achat: [],
      shop: [],
      abus: [],
    };
    for (const [k, v] of valueMap) {
      if (!k.startsWith(TICKET_ACCESS_PREFIX)) continue;
      if (!/^(true|1)$/i.test(v)) continue;
      const rest = k.slice(TICKET_ACCESS_PREFIX.length); // "<kind>.<roleId>"
      const dot = rest.indexOf(".");
      if (dot === -1) continue;
      const kind = rest.slice(0, dot);
      const roleId = rest.slice(dot + 1);
      if (!(kind in out)) continue;
      out[kind]!.push(roleId);
    }
    return out;
  }, [valueMap]);

  if (schema.isLoading)
    return (
      <div className="text-zinc-500 text-sm">
        Chargement de la configuration…
      </div>
    );

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-lg border px-4 py-3 text-sm shadow-xl ${
            toast.type === "success"
              ? "border-green-500/50 bg-dbz-card text-green-300"
              : "border-red-500/50 bg-dbz-card text-red-300"
          }`}
        >
          {toast.msg}
        </div>
      )}
      <div className="dbz-panel p-4">
        <div className="flex items-center gap-2 mb-2">
          <SettingsIcon className="h-5 w-5 text-dbz-orange" />
          <h2 className="text-lg font-saiyan text-dbz-orange uppercase">
            Configuration du bot
          </h2>
        </div>
        <p className="text-sm text-zinc-300">
          Tous les réglages du bot sont regroupés ici : quels salons utiliser,
          quels rôles assigner, combien d'XP gagner par message… Chaque valeur a
          un défaut intégré ; vous ne modifiez que ce que vous souhaitez
          personnaliser.
        </p>
        <p className="mt-1 text-xs text-dbz-blue-light">
          {schema.data?.keys.filter((k) => !k.prefix).length ?? 0} paramètres ·
          {overriddenCount} personnalisé{overriddenCount > 1 ? "s" : ""} · les
          valeurs par défaut s'appliquent si rien n'est défini · cache bot 30 s
        </p>
      </div>

      {grouped.map(({ category, keys }) => (
        <CategorySection
          key={category}
          category={category}
          keys={keys}
          valueMap={valueMap}
          onSet={(key, value) => set.mutate({ key, value })}
          onUnset={(key) => unset.mutate(key)}
          xpBoostRoles={category === "xp" ? xpBoostRoles : undefined}
          ticketAccessRoles={
            category === "tickets" ? ticketAccessRoles : undefined
          }
          pending={set.isPending || unset.isPending}
        />
      ))}
    </div>
  );
}

function CategorySection({
  category,
  keys,
  valueMap,
  onSet,
  onUnset,
  xpBoostRoles,
  ticketAccessRoles,
  pending,
}: {
  category: string;
  keys: SettingDef[];
  valueMap: Map<string, string>;
  onSet: (key: string, value: string) => void;
  onUnset: (key: string) => void;
  xpBoostRoles?: { roleId: string; multiplier: string }[];
  ticketAccessRoles?: Record<string, string[]>;
  pending: boolean;
}) {
  const meta = CATEGORY_META[category] ?? {
    label: category,
    icon: SettingsIcon,
    desc: "",
  };
  // `meta` est une union (CATEGORY_META[...] ?? fallback) dont l'intersection des
  // props composant donne `never` sous les types React canary → cast explicite.
  const Icon = meta.icon as React.ComponentType<{ className?: string }>;
  const [open, setOpen] = useState(
    category === "features" || category === "channels",
  );
  const overridden = keys.filter(
    (k) => !k.prefix && valueMap.has(k.key),
  ).length;
  const total = keys.filter((k) => !k.prefix).length;

  return (
    <div className="card p-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-zinc-900/40"
      >
        <Icon className="h-5 w-5 shrink-0 text-brand-400" />
        <div className="flex-1">
          <h3 className="font-semibold">{meta.label}</h3>
          <p className="text-xs text-zinc-500">{meta.desc}</p>
          {category === "tickets" && ticketAccessRoles && (
            <TicketAccessEditor
              entries={ticketAccessRoles}
              onSet={(kind, roleId) =>
                onSet(`${TICKET_ACCESS_PREFIX}${kind}.${roleId}`, "1")
              }
              onUnset={(kind, roleId) =>
                onUnset(`${TICKET_ACCESS_PREFIX}${kind}.${roleId}`)
              }
              pending={pending}
            />
          )}
        </div>
        <span className="badge">
          {overridden} / {total} surchargé{overridden > 1 ? "s" : ""}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-zinc-800 p-4">
          <div className="space-y-2">
            {keys
              .filter((k) => !k.prefix)
              .map((k) => (
                <SettingRow
                  key={k.key}
                  def={k}
                  current={valueMap.get(k.key)}
                  onSet={(v) => onSet(k.key, v)}
                  onUnset={() => onUnset(k.key)}
                  pending={pending}
                />
              ))}
          </div>
          {category === "xp" && xpBoostRoles && (
            <XpBoostRoleEditor
              entries={xpBoostRoles}
              onSet={(roleId, mult) => onSet(`xp.boost.role.${roleId}`, mult)}
              onUnset={(roleId) => onUnset(`xp.boost.role.${roleId}`)}
              pending={pending}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SettingRow({
  def,
  current,
  onSet,
  onUnset,
  pending,
}: {
  def: SettingDef;
  current: string | undefined;
  onSet: (value: string) => void;
  onUnset: () => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState<string>(current ?? "");
  const [editing, setEditing] = useState(false);

  const isOverridden = current !== undefined;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-sm font-medium">{def.key}</code>
            {isOverridden && (
              <span className="badge badge-warning">surchargé</span>
            )}
            {!isOverridden && def.default !== undefined && (
              <span className="text-xs text-zinc-500">
                défaut : {String(def.default)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-400">{def.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!editing && (
            <SettingValuePreview
              def={def}
              value={current ?? def.default?.toString() ?? ""}
            />
          )}
          <button
            type="button"
            onClick={() => {
              setDraft(current ?? "");
              setEditing(!editing);
            }}
            className="btn btn-ghost px-2"
          >
            {editing ? "Fermer" : isOverridden ? "Modifier" : "Définir"}
          </button>
          {isOverridden && (
            <button
              type="button"
              onClick={onUnset}
              className="btn btn-ghost px-2 text-red-400"
              title="Supprimer la surcharge (retour au défaut)"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3">
          <SettingValueInput def={def} value={draft} onChange={setDraft} />
          <button
            type="button"
            onClick={() => {
              if (draft === "") return;
              onSet(draft);
              setEditing(false);
            }}
            disabled={pending || !draft}
            className="btn btn-primary"
          >
            Enregistrer
          </button>
        </div>
      )}
    </div>
  );
}

function SettingValueInput({
  def,
  value,
  onChange,
}: {
  def: SettingDef;
  value: string;
  onChange: (v: string) => void;
}) {
  if (def.type === "snowflake" && def.key.startsWith("channel.")) {
    const types =
      def.channelType === "voice"
        ? [2, 13]
        : def.channelType === "category"
          ? [4]
          : def.channelType === "any"
            ? [0, 2, 4, 5, 13, 15]
            : [0, 5, 15];
    return (
      <ChannelSelect
        value={value}
        onChange={onChange}
        types={types}
        className="flex-1"
      />
    );
  }
  if (def.type === "snowflake" && def.key.startsWith("role.")) {
    return <RoleSelect value={value} onChange={onChange} className="flex-1" />;
  }
  if (def.type === "snowflake") {
    return (
      <input
        className="input flex-1 font-mono text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="snowflake (17-20 chiffres)"
      />
    );
  }
  if (def.type === "bool") {
    return (
      <select
        className="input flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Choisir —</option>
        <option value="true">true (activé)</option>
        <option value="false">false (désactivé)</option>
      </select>
    );
  }
  if (def.type === "int" || def.type === "float") {
    return (
      <input
        className="input flex-1"
        type="number"
        step={def.type === "float" ? "0.01" : "1"}
        min={def.min}
        max={def.max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  // JSON editor pour les keys connues + auto-detect (valeur courante = JSON)
  const isJsonKey = def.key === "moderation.hierarchy" || looksLikeJson(value);
  if (def.type === "string" && isJsonKey) {
    return <JsonEditor value={value} onChange={onChange} rows={6} />;
  }
  return (
    <input
      className="input flex-1"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function GifPreview({ url }: { url: string }) {
  if (!/^https:\/\//i.test(url))
    return (
      <span className="text-xs italic text-zinc-600">URL https requise</span>
    );
  return (
    <div className="flex items-center gap-2">
      {}
      <img
        src={url}
        alt=""
        className="h-10 w-16 rounded border border-zinc-800 object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-zinc-400 hover:text-brand-400"
        title={url}
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function SettingValuePreview({
  def,
  value,
}: {
  def: SettingDef;
  value: string;
}) {
  if (!value)
    return <span className="text-xs italic text-zinc-600">non défini</span>;
  if (def.key.startsWith("gif.")) {
    return <GifPreview url={value} />;
  }
  if (def.type === "snowflake" && def.key.startsWith("channel.")) {
    return <ChannelInline channelId={value} />;
  }
  if (def.type === "snowflake" && def.key.startsWith("role.")) {
    return <RoleInline roleId={value} />;
  }
  if (def.type === "bool") {
    const on = value === "true" || value === "1";
    return (
      <span className={`badge ${on ? "badge-success" : "badge-error"}`}>
        {on ? "ON" : "OFF"}
      </span>
    );
  }
  if (def.type === "int" || def.type === "float") {
    return (
      <code className="rounded bg-zinc-800 px-2 py-1 text-xs font-mono">
        {Number(value).toLocaleString("fr-FR")}
      </code>
    );
  }
  return (
    <code className="rounded bg-zinc-800 px-2 py-1 text-xs font-mono">
      {value}
    </code>
  );
}

function ChannelInline({ channelId }: { channelId: string }) {
  const { data } = useQuery({
    queryKey: ["discord", "channels"],
    queryFn: () =>
      api.get<{ channels: { id: string; name: string; type: number }[] }>(
        "/discord/channels",
      ),
    staleTime: 30_000,
  });
  const c = data?.channels.find((x) => x.id === channelId);
  return (
    <code className="rounded bg-zinc-800 px-2 py-1 text-xs">
      {c ? `#${c.name}` : channelId}
    </code>
  );
}

function RoleInline({ roleId }: { roleId: string }) {
  const { data } = useQuery({
    queryKey: ["discord", "roles"],
    queryFn: () =>
      api.get<{ roles: { id: string; name: string; color: number }[] }>(
        "/discord/roles",
      ),
    staleTime: 30_000,
  });
  const r = data?.roles.find((x) => x.id === roleId);
  return (
    <code
      className="rounded bg-zinc-800 px-2 py-1 text-xs"
      style={
        r && r.color !== 0
          ? { color: `#${r.color.toString(16).padStart(6, "0")}` }
          : undefined
      }
    >
      {r ? `@${r.name}` : roleId}
    </code>
  );
}

function XpBoostRoleEditor({
  entries,
  onSet,
  onUnset,
  pending,
}: {
  entries: { roleId: string; multiplier: string }[];
  onSet: (roleId: string, mult: string) => void;
  onUnset: (roleId: string) => void;
  pending: boolean;
}) {
  const [roleId, setRoleId] = useState("");
  const [mult, setMult] = useState("1.5");
  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Multiplicateurs XP par rôle ({entries.length})
      </h4>
      <p className="mb-3 text-xs text-zinc-500">
        Si un membre a plusieurs rôles boostés, on prend le <strong>max</strong>{" "}
        (ne stack pas).
      </p>
      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.roleId} className="flex items-center gap-2">
            <RoleInline roleId={e.roleId} />
            <span className="text-xs text-zinc-500">×</span>
            <code className="rounded bg-zinc-800 px-2 py-1 text-xs">
              {e.multiplier}
            </code>
            <button
              type="button"
              onClick={() => onUnset(e.roleId)}
              className="btn btn-ghost px-2 text-red-400"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <RoleSelect value={roleId} onChange={setRoleId} />
        <input
          className="input"
          type="number"
          step="0.1"
          min="0.1"
          value={mult}
          onChange={(e) => setMult(e.target.value)}
          placeholder="1.5"
        />
        <button
          type="button"
          onClick={() => {
            if (!roleId || !mult) return;
            onSet(roleId, mult);
            setRoleId("");
            setMult("1.5");
          }}
          disabled={pending || !roleId || !mult}
          className="btn btn-primary"
        >
          Ajouter le booster
        </button>
      </div>
    </div>
  );
}

function TicketAccessEditor({
  entries,
  onSet,
  onUnset,
  pending,
}: {
  entries: Record<string, string[]>;
  onSet: (kind: string, roleId: string) => void;
  onUnset: (kind: string, roleId: string) => void;
  pending: boolean;
}) {
  const [kind, setKind] = useState<(typeof TICKET_KINDS)[number]>("report");
  const [roleId, setRoleId] = useState("");
  const current = entries[kind] ?? [];

  const sync = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; updated: number; skipped: number }>(
        "/tickets/sync-access",
      ),
  });

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Accès staff par type de ticket
      </h4>
      <p className="mb-3 text-xs text-zinc-500">
        Rôles ajoutés ici = accès (voir + écrire) aux <strong>nouveaux</strong>{" "}
        tickets de ce type dès leur ouverture. Les Administrateurs voient déjà
        tout (bypass Discord). Pour appliquer aussi aux tickets déjà ouverts,
        utiliser le bouton de resync ci-dessous.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {TICKET_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`btn ${kind === k ? "btn-primary" : "btn-ghost"}`}
          >
            {TICKET_KIND_META[k].emoji} {TICKET_KIND_META[k].label}
            <span className="ml-1 text-xs opacity-70">
              ({(entries[k] ?? []).length})
            </span>
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {current.length === 0 && (
          <p className="text-xs italic text-zinc-600">
            Aucun rôle configuré pour « {TICKET_KIND_META[kind].label} » — seul
            l'auteur du ticket (+ Administrateur) le voit.
          </p>
        )}
        {current.map((rid) => (
          <div key={rid} className="flex items-center gap-2">
            <RoleInline roleId={rid} />
            <button
              type="button"
              onClick={() => onUnset(kind, rid)}
              className="btn btn-ghost px-2 text-red-400"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <RoleSelect value={roleId} onChange={setRoleId} className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (!roleId || current.includes(roleId)) return;
            onSet(kind, roleId);
            setRoleId("");
          }}
          disabled={pending || !roleId || current.includes(roleId)}
          className="btn btn-primary"
        >
          Ajouter
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3">
        <button
          type="button"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="btn btn-ghost"
        >
          <RefreshCw
            className={`h-3 w-3 ${sync.isPending ? "animate-spin" : ""}`}
          />
          Appliquer aux tickets déjà ouverts
        </button>
        {sync.data && (
          <span className="text-xs text-zinc-400">
            {sync.data.updated} salon(s) mis à jour
            {sync.data.skipped > 0
              ? ` · ${sync.data.skipped} introuvable(s)`
              : ""}
          </span>
        )}
        {sync.isError && (
          <span className="text-xs text-red-400">
            {sync.error instanceof Error ? sync.error.message : "échec"}
          </span>
        )}
      </div>
    </div>
  );
}
