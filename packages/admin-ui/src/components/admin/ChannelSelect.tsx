"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@aphrody/admin-ui/client";

interface Channel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position?: number;
}

const TYPE_PREFIX: Record<number, string> = {
  0: "#",
  2: "🔊 ",
  4: "▾ ",
  5: "📣 ",
  13: "🎙 ",
  15: "🧵 ",
};

interface Props {
  value: string;
  onChange: (channelId: string) => void;
  /** Filtrer par types Discord (0=text, 2=voice, 5=announcement, 13=stage, 15=forum) */
  types?: number[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Sélecteur de salon Discord avec préfixe icône type + groupement par catégorie.
 */
export function ChannelSelect({
  value,
  onChange,
  types = [0, 5, 15],
  placeholder = "— Sélectionner un salon —",
  required,
  disabled,
  className,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["discord", "channels"],
    queryFn: () => api.get<{ channels: Channel[] }>("/discord/channels"),
    staleTime: 30_000,
  });

  const grouped = useMemo(() => {
    const all = data?.channels ?? [];
    const cats = all.filter((c) => c.type === 4);
    const filtered = all.filter((c) => types.includes(c.type));
    const byCat = new Map<string | null, Channel[]>();
    for (const c of filtered) {
      const key = c.parentId ?? null;
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key)!.push(c);
    }
    for (const arr of byCat.values()) {
      arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    }
    const sortedCats = [...cats].toSorted(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );
    return { byCat, sortedCats };
  }, [data, types]);

  return (
    <select
      className={`input ${className ?? ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      disabled={disabled || isLoading}
    >
      <option value="">{isLoading ? "Chargement…" : placeholder}</option>
      {grouped.byCat.get(null)?.map((c) => (
        <option key={c.id} value={c.id}>
          {TYPE_PREFIX[c.type] ?? ""}
          {c.name}
        </option>
      ))}
      {grouped.sortedCats.map((cat) => {
        const children = grouped.byCat.get(cat.id);
        if (!children?.length) return null;
        return (
          <optgroup key={cat.id} label={`▾ ${cat.name}`}>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {TYPE_PREFIX[c.type] ?? ""}
                {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
