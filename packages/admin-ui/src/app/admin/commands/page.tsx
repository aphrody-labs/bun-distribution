"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Lock,
  Power,
  RotateCcw,
  Shield,
  Slash,
  Trash2,
  UserMinus,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import {
  RoleBadge,
  RoleSelect,
} from "@aphrody/admin-ui/components/admin/RoleSelect";

interface CommandLeaf {
  name: string;
  description: string;
  group: string;
}

interface PermissionRule {
  name: string;
  enabled: boolean;
  allowedRoles: string[];
  deniedRoles: string[];
  deniedUsers: string[];
}

const GLOBAL_KEY = "*";

export default function CommandsPage() {
  const qc = useQueryClient();

  const commands = useQuery({
    queryKey: ["bot", "commands", "expanded"],
    queryFn: () =>
      api.get<{ commands: CommandLeaf[] }>("/bot/commands/expanded"),
    staleTime: 60_000,
  });

  const rules = useQuery({
    queryKey: ["commands", "permissions"],
    queryFn: () =>
      api.get<{ rules: PermissionRule[] }>("/bot/commands/permissions"),
    staleTime: 30_000,
  });

  const upsert = useMutation({
    mutationFn: (rule: PermissionRule) =>
      api.post("/bot/commands/permissions", rule),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["commands", "permissions"] }),
  });
  const remove = useMutation({
    mutationFn: (name: string) =>
      api.post("/bot/commands/permissions/delete", { name }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["commands", "permissions"] }),
  });

  const ruleByName = useMemo(() => {
    const m = new Map<string, PermissionRule>();
    for (const r of rules.data?.rules ?? []) m.set(r.name, r);
    return m;
  }, [rules.data]);

  const groups = useMemo(() => {
    const list = commands.data?.commands ?? [];
    const m = new Map<string, CommandLeaf[]>();
    for (const c of list) {
      if (!m.has(c.group)) m.set(c.group, []);
      m.get(c.group)!.push(c);
    }
    return [...m.entries()]
      .map(([group, items]) => ({
        group,
        items: items.toSorted((a, b) => a.name.localeCompare(b.name)),
      }))
      .toSorted((a, b) => a.group.localeCompare(b.group));
  }, [commands.data]);

  const overriddenCount =
    ruleByName.size - (ruleByName.has(GLOBAL_KEY) ? 1 : 0);
  const globalRule = ruleByName.get(GLOBAL_KEY);

  if (commands.isLoading || rules.isLoading) {
    return (
      <div className="text-zinc-500 text-sm">Chargement des commandes…</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="dbz-panel p-4">
        <div className="flex items-center gap-2 mb-2">
          <Slash className="h-5 w-5 text-dbz-orange" />
          <h2 className="text-lg font-saiyan text-dbz-orange uppercase">
            Permissions des commandes Discord
          </h2>
        </div>
        <p className="text-sm text-zinc-300">
          Définissez qui peut utiliser chaque commande slash du bot : activer /
          désactiver une commande, l'autoriser uniquement à certains rôles ou
          l'interdire à des utilisateurs spécifiques. Les propriétaires du
          serveur et les membres avec la permission{" "}
          <strong>Administrateur</strong> Discord contournent toujours ces
          règles.
        </p>
        <p className="mt-1 text-xs text-dbz-blue-light">
          {commands.data?.commands.length ?? 0} commandes disponibles ·{" "}
          {overriddenCount} règle
          {overriddenCount > 1 ? "s" : ""} personnalisée
          {overriddenCount > 1 ? "s" : ""} · cache bot 30 s · hiérarchie : règle
          exacte → joker du groupe → joker global
        </p>
      </div>

      <GlobalRuleCard
        rule={globalRule}
        onSet={(r) => upsert.mutate(r)}
        onUnset={() => remove.mutate(GLOBAL_KEY)}
        pending={upsert.isPending || remove.isPending}
      />

      {groups.map(({ group, items }) => (
        <GroupSection
          key={group}
          group={group}
          items={items}
          ruleByName={ruleByName}
          onSet={(r) => upsert.mutate(r)}
          onUnset={(name) => remove.mutate(name)}
          pending={upsert.isPending || remove.isPending}
        />
      ))}
    </div>
  );
}

function GlobalRuleCard({
  rule,
  onSet,
  onUnset,
  pending,
}: {
  rule: PermissionRule | undefined;
  onSet: (rule: PermissionRule) => void;
  onUnset: () => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="dbz-panel p-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-dbz-blue-light/5"
      >
        <Shield className="h-5 w-5 shrink-0 text-amber-400" />
        <div className="flex-1">
          <h3 className="font-semibold text-zinc-100">
            Règle par défaut (s'applique à toutes les commandes sans règle
            spécifique)
          </h3>
          <p className="text-xs text-zinc-500">
            Si une commande n'a pas de règle propre, cette règle s'applique.
          </p>
        </div>
        {rule ? (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/50">
            active
          </span>
        ) : (
          <span className="text-xs text-zinc-500">aucune règle définie</span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-dbz-border p-4">
          <RuleEditor
            name={GLOBAL_KEY}
            label="Règle par défaut"
            rule={rule}
            onSet={onSet}
            onUnset={onUnset}
            pending={pending}
          />
        </div>
      )}
    </div>
  );
}

function GroupSection({
  group,
  items,
  ruleByName,
  onSet,
  onUnset,
  pending,
}: {
  group: string;
  items: CommandLeaf[];
  ruleByName: Map<string, PermissionRule>;
  onSet: (rule: PermissionRule) => void;
  onUnset: (name: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wildcardName = `${group} *`;
  const wildcardRule = ruleByName.get(wildcardName);
  const overridden =
    items.filter((c) => ruleByName.has(c.name)).length + (wildcardRule ? 1 : 0);
  const hasMultipleLeaves = items.length > 1 || items[0]?.name !== group;

  return (
    <div className="dbz-panel p-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-dbz-blue-light/5"
      >
        <Slash className="h-5 w-5 shrink-0 text-dbz-orange" />
        <div className="flex-1">
          <h3 className="font-semibold text-zinc-100">/{group}</h3>
          <p className="text-xs text-zinc-500">
            {items.length} commande{items.length > 1 ? "s" : ""}
          </p>
        </div>
        <span className="text-xs text-zinc-400">
          {overridden} / {items.length + (hasMultipleLeaves ? 1 : 0)} règle
          {overridden > 1 ? "s" : ""}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-dbz-border p-4">
          {hasMultipleLeaves && (
            <RuleEditor
              name={wildcardName}
              label={`Toutes les sous-commandes de /${group}`}
              description={`S'applique à toute sous-commande de /${group} sans règle exacte.`}
              rule={wildcardRule}
              onSet={onSet}
              onUnset={() => onUnset(wildcardName)}
              pending={pending}
            />
          )}
          {items.map((c) => (
            <RuleEditor
              key={c.name}
              name={c.name}
              label={`/${c.name}`}
              description={c.description}
              rule={ruleByName.get(c.name)}
              onSet={onSet}
              onUnset={() => onUnset(c.name)}
              pending={pending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RuleEditor({
  name,
  label,
  description,
  rule,
  onSet,
  onUnset,
  pending,
}: {
  name: string;
  label: string;
  description?: string;
  rule: PermissionRule | undefined;
  onSet: (rule: PermissionRule) => void;
  onUnset: () => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PermissionRule>(() => ({
    name,
    enabled: rule?.enabled ?? true,
    allowedRoles: rule?.allowedRoles ?? [],
    deniedRoles: rule?.deniedRoles ?? [],
    deniedUsers: rule?.deniedUsers ?? [],
  }));

  const isOverridden = !!rule;
  const summary = summarizeRule(rule);

  function startEdit() {
    setDraft({
      name,
      enabled: rule?.enabled ?? true,
      allowedRoles: rule?.allowedRoles ?? [],
      deniedRoles: rule?.deniedRoles ?? [],
      deniedUsers: rule?.deniedUsers ?? [],
    });
    setEditing(true);
  }

  function handleUnset() {
    if (
      !confirm(
        `Supprimer la règle pour « ${label} » ?\n\nLes réglages par défaut s'appliqueront à nouveau.`,
      )
    )
      return;
    onUnset();
  }

  return (
    <div className="rounded-lg border border-dbz-border bg-dbz-bg/40 p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-sm font-medium text-zinc-100">{label}</code>
            {isOverridden && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  rule?.enabled
                    ? "text-amber-300 border-amber-700/50 bg-amber-900/30"
                    : "text-red-300 border-red-700/50 bg-red-900/30"
                }`}
              >
                {rule?.enabled ? "règle active" : "commande désactivée"}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-xs text-zinc-400">{description}</p>
          )}
          {summary && <p className="mt-1 text-xs text-zinc-500">{summary}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={editing ? () => setEditing(false) : startEdit}
            className="text-xs px-2 py-1 border border-dbz-border text-zinc-300 hover:text-dbz-orange hover:border-dbz-orange/50 rounded transition-colors"
          >
            {editing
              ? "Fermer"
              : isOverridden
                ? "Modifier"
                : "Définir une règle"}
          </button>
          {isOverridden && (
            <button
              type="button"
              onClick={handleUnset}
              className="text-xs px-2 py-1 border border-red-900/50 text-red-400 hover:bg-red-900/20 rounded transition-colors"
              title="Supprimer la règle (retour aux paramètres par défaut)"
              disabled={pending}
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3 space-y-3 border-t border-dbz-border pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) =>
                setDraft({ ...draft, enabled: e.target.checked })
              }
              className="h-4 w-4 accent-dbz-orange"
            />
            <Power className="h-4 w-4 text-zinc-500" />
            <span className="text-zinc-200">
              Commande activée
              <span className="ml-1 text-xs text-zinc-500">
                (décocher pour la désactiver pour tout le monde, sauf
                administrateurs)
              </span>
            </span>
          </label>

          <RoleListEditor
            label="Rôles autorisés"
            hint="Si la liste n'est pas vide, seuls les membres ayant au moins un de ces rôles pourront utiliser la commande."
            icon={<Shield className="h-4 w-4 text-emerald-400" />}
            roles={draft.allowedRoles}
            onChange={(roles) => setDraft({ ...draft, allowedRoles: roles })}
          />

          <RoleListEditor
            label="Rôles interdits"
            hint="Les membres ayant un de ces rôles seront refusés, quelles que soient les autres règles."
            icon={<Lock className="h-4 w-4 text-red-400" />}
            roles={draft.deniedRoles}
            onChange={(roles) => setDraft({ ...draft, deniedRoles: roles })}
          />

          <UserIdListEditor
            label="Utilisateurs bloqués"
            hint="Identifiant Discord de l'utilisateur (numéro à 17-20 chiffres, visible dans les paramètres Discord)."
            icon={<UserMinus className="h-4 w-4 text-red-400" />}
            users={draft.deniedUsers}
            onChange={(users) => setDraft({ ...draft, deniedUsers: users })}
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onSet(draft);
                setEditing(false);
              }}
              disabled={pending}
              className="dbz-button !text-xs !px-3 !py-1.5"
            >
              Enregistrer
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs px-3 py-1.5 border border-dbz-border text-zinc-400 hover:text-zinc-200 rounded transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function summarizeRule(rule: PermissionRule | undefined): string {
  if (!rule) return "";
  const parts: string[] = [];
  if (!rule.enabled) parts.push("désactivée");
  if (rule.allowedRoles.length > 0)
    parts.push(
      `${rule.allowedRoles.length} rôle${rule.allowedRoles.length > 1 ? "s" : ""} autorisé${rule.allowedRoles.length > 1 ? "s" : ""}`,
    );
  if (rule.deniedRoles.length > 0)
    parts.push(
      `${rule.deniedRoles.length} rôle${rule.deniedRoles.length > 1 ? "s" : ""} interdit${rule.deniedRoles.length > 1 ? "s" : ""}`,
    );
  if (rule.deniedUsers.length > 0)
    parts.push(
      `${rule.deniedUsers.length} utilisateur${rule.deniedUsers.length > 1 ? "s" : ""} bloqué${rule.deniedUsers.length > 1 ? "s" : ""}`,
    );
  return parts.join(" · ");
}

function RoleListEditor({
  label,
  hint,
  icon,
  roles,
  onChange,
}: {
  label: string;
  hint: string;
  icon: React.ReactNode;
  roles: string[];
  onChange: (roles: string[]) => void;
}) {
  const [pick, setPick] = useState("");
  return (
    <div className="rounded-md border border-dbz-border bg-dbz-bg/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium text-zinc-200">{label}</span>
        <span className="text-xs text-zinc-500">({roles.length})</span>
      </div>
      <p className="mb-2 text-xs text-zinc-500">{hint}</p>
      {roles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {roles.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1 text-xs"
            >
              <RoleBadge roleId={id} />
              <button
                type="button"
                onClick={() => onChange(roles.filter((r) => r !== id))}
                className="text-zinc-500 hover:text-red-400"
                title="Retirer ce rôle"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <RoleSelect value={pick} onChange={setPick} className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (!pick || roles.includes(pick)) return;
            onChange([...roles, pick]);
            setPick("");
          }}
          disabled={!pick || roles.includes(pick)}
          className="text-xs px-2 py-1 border border-dbz-border text-zinc-300 hover:text-dbz-orange hover:border-dbz-orange/50 rounded transition-colors disabled:opacity-40"
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}

function UserIdListEditor({
  label,
  hint,
  icon,
  users,
  onChange,
}: {
  label: string;
  hint: string;
  icon: React.ReactNode;
  users: string[];
  onChange: (users: string[]) => void;
}) {
  const [pick, setPick] = useState("");
  const valid = /^\d{17,20}$/.test(pick);
  return (
    <div className="rounded-md border border-dbz-border bg-dbz-bg/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium text-zinc-200">{label}</span>
        <span className="text-xs text-zinc-500">({users.length})</span>
      </div>
      <p className="mb-2 text-xs text-zinc-500">{hint}</p>
      {users.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {users.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1 font-mono text-xs"
            >
              {id}
              <button
                type="button"
                onClick={() => onChange(users.filter((u) => u !== id))}
                className="text-zinc-500 hover:text-red-400"
                title="Retirer cet utilisateur"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          placeholder="Identifiant Discord (17-20 chiffres)"
          className="flex-1 bg-dbz-bg border border-dbz-border rounded px-2 py-1 font-mono text-xs focus:border-dbz-orange outline-none"
        />
        <button
          type="button"
          onClick={() => {
            if (!valid || users.includes(pick)) return;
            onChange([...users, pick]);
            setPick("");
          }}
          disabled={!valid || users.includes(pick)}
          className="text-xs px-2 py-1 border border-dbz-border text-zinc-300 hover:text-dbz-orange hover:border-dbz-orange/50 rounded transition-colors disabled:opacity-40"
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}
