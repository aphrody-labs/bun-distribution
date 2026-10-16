"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@aphrody/admin-ui/client";

interface Role {
  id: string;
  name: string;
  color: number;
  position: number;
  managed?: boolean;
  /** Rôle de boost serveur (Nitro). `managed` mais porté par des humains. */
  premiumSubscriber?: boolean;
  hoist?: boolean;
}

/**
 * Affiche un rôle (nom + pastille couleur) à partir d'un roleId.
 * Réutilise le même cache react-query que RoleSelect (key `["discord","roles"]`).
 */
export function RoleBadge({ roleId }: { roleId: string }) {
  const { data } = useQuery({
    queryKey: ["discord", "roles"],
    queryFn: () => api.get<{ roles: Role[]; count: number }>("/discord/roles"),
    staleTime: 30_000,
  });
  const role = data?.roles.find((r) => r.id === roleId);
  const color =
    role && role.color !== 0
      ? `#${role.color.toString(16).padStart(6, "0")}`
      : "#71717a";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full border border-dbz-border"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span style={role && role.color !== 0 ? { color } : undefined}>
        {role?.name ?? <code className="font-mono text-xs">{roleId}</code>}
      </span>
    </span>
  );
}

interface Props {
  value: string;
  onChange: (roleId: string) => void;
  placeholder?: string;
  required?: boolean;
  excludeManaged?: boolean;
  disabled?: boolean;
  className?: string;
  /** Affiche `(@everyone)` parmi les choix */
  includeEveryone?: boolean;
}

/**
 * Sélecteur de rôle Discord avec indicateur couleur.
 * Source : /api/discord/roles (cache local du bot, pas de hit REST).
 */
export function RoleSelect({
  value,
  onChange,
  placeholder = "— Sélectionner un rôle —",
  required,
  excludeManaged = true,
  includeEveryone = false,
  disabled,
  className,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["discord", "roles"],
    queryFn: () => api.get<{ roles: Role[]; count: number }>("/discord/roles"),
    staleTime: 30_000,
  });

  const roles = useMemo(() => {
    let list = data?.roles ?? [];
    // `excludeManaged` vise les rôles d'intégration (bots) — le rôle de boost
    // serveur reste sélectionnable (gating, boosts XP, accès staff…).
    if (excludeManaged)
      list = list.filter((r) => !r.managed || r.premiumSubscriber);
    if (!includeEveryone) list = list.filter((r) => r.name !== "@everyone");
    return [...list].toSorted((a, b) => b.position - a.position);
  }, [data, excludeManaged, includeEveryone]);

  const selected = roles.find((r) => r.id === value);
  const dotColor = selected
    ? `#${selected.color.toString(16).padStart(6, "0")}`
    : "transparent";

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      {selected && (
        <span
          className="h-3 w-3 shrink-0 rounded-full border border-dbz-border"
          style={{
            backgroundColor: selected.color === 0 ? "#71717a" : dotColor,
          }}
          aria-hidden
        />
      )}
      <select
        className="input flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled || isLoading}
      >
        <option value="">{isLoading ? "Chargement…" : placeholder}</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.premiumSubscriber ? " · boost" : ""}
            {r.color !== 0
              ? ` · #${r.color.toString(16).padStart(6, "0")}`
              : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
