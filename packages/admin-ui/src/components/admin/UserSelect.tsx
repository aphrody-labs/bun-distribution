"use client";

/**
 * UserSelect — sélecteur de membre Discord avec recherche « smart ».
 *
 * Combobox (pas un <select> : 6000+ membres) : recherche debouncée sur pseudo,
 * nom d'affichage OU id via /api/discord/members?search= (cache local du bot,
 * filtre username+displayName+id, retourne avatar+displayName+bot). Retourne l'id
 * choisi via onChange. À utiliser partout où un ID membre est demandé (XP, solde,
 * modération…) au lieu d'un champ ID brut. Cf. RoleSelect / ChannelSelect pour
 * les rôles / salons.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Croix, Recherche } from "@/components/icones";
import { api } from "@aphrody/admin-ui/client";

interface Member {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bot?: boolean;
}

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Affiche un membre (avatar + nom d'affichage) à partir d'un id, en lecture seule. */

interface Props {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function UserSelect({
  value,
  onChange,
  placeholder = "Rechercher un membre (pseudo, nom d'affichage ou ID)…",
  disabled,
  className,
}: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 250);
  const boxRef = useRef<HTMLDivElement>(null);

  // Résout le membre sélectionné (id → libellé) pour l'affichage compact.
  const selectedQuery = useQuery({
    queryKey: ["discord", "member", value],
    queryFn: () =>
      api.get<{ members: Member[] }>(
        `/discord/members?search=${encodeURIComponent(value)}&limit=5`,
      ),
    staleTime: 60_000,
    enabled: !!value,
  });
  const selected = selectedQuery.data?.members.find((m) => m.id === value) ?? null;

  // Recherche live (dropdown).
  const search = useQuery({
    queryKey: ["discord", "members", "search", debounced],
    queryFn: () =>
      api.get<{ members: Member[] }>(
        `/discord/members?search=${encodeURIComponent(debounced)}&limit=25`,
      ),
    staleTime: 30_000,
    enabled: open && debounced.trim().length >= 1,
  });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const results = search.data?.members ?? [];

  return (
    <div ref={boxRef} className={`relative ${className ?? ""}`}>
      {value && !open ? (
        <div className="flex items-center gap-2 rounded-lg border border-dbz-border bg-dbz-bg/60 px-2 py-1.5">
          {selected?.avatar && (
            <img src={selected.avatar} alt="" className="h-6 w-6 rounded-full" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm">
            {selected ? (
              <>
                <span className="font-semibold text-white">{selected.displayName}</span>{" "}
                <span className="text-white/50">@{selected.username}</span>
              </>
            ) : (
              <code className="font-mono text-xs text-white/70">{value}</code>
            )}
          </span>
          {!disabled && (
            <>
              <button
                type="button"
                onClick={() => {
                  setOpen(true);
                  setQ("");
                }}
                className="btn btn-ghost px-2 py-0.5 text-xs"
              >
                Changer
              </button>
              <button
                type="button"
                onClick={() => onChange("")}
                className="btn btn-ghost px-1 text-red-400"
                title="Retirer"
              >
                <Croix className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-dbz-border bg-dbz-bg/60 px-2">
          <Recherche className="h-4 w-4 shrink-0 text-white/50" />
          <input
            className="w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-white/50"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            spellCheck={false}
          />
        </div>
      )}
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-dbz-border bg-dbz-card shadow-xl">
          {search.isLoading && <p className="p-2 text-xs text-zinc-500">Recherche…</p>}
          {!search.isLoading && debounced.trim().length < 1 && (
            <p className="p-2 text-xs text-zinc-500">
              Tape un pseudo, un nom d'affichage ou un ID.
            </p>
          )}
          {!search.isLoading && debounced.trim().length >= 1 && results.length === 0 && (
            <p className="p-2 text-xs text-zinc-500">Aucun membre trouvé.</p>
          )}
          {results.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                onChange(m.id);
                setOpen(false);
                setQ("");
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-dbz-orange/10"
            >
              {m.avatar && <img src={m.avatar} alt="" className="h-7 w-7 rounded-full" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">
                  {m.displayName}
                  {m.bot && (
                    <span className="ml-1 rounded bg-dbz-blue/50 px-1 text-[9px] uppercase">
                      bot
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-white/50">
                  @{m.username} · {m.id}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
