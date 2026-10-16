// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useId, useRef, useState } from "react";

export type FilterOption = { value: string; label: string; count?: number };

/**
 * Filtre déroulant multi-sélection (cases à cocher). Remplace les rangées de
 * boutons-chips qui débordaient l'écran : un seul champ compact qui se déroule
 * en liste cochable. Léger (zéro dépendance Radix), accessible (Échap + clic
 * extérieur ferment, rôles listbox/option), thémé DBZ.
 */
export function FilterDropdown({
  label,
  options,
  selected,
  onChange,
  searchable = false,
  align = "left",
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Ajoute un champ de recherche interne quand la liste est longue. */
  searchable?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Échap sans rendre le focus laissait l'utilisateur au clavier reparti
      // en haut du document : la tabulation suivante recommençait la page.
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (v: string) =>
    onChange(
      selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v],
    );

  const shown =
    searchable && q.trim()
      ? options.filter((o) =>
          o.label.toLowerCase().includes(q.trim().toLowerCase()),
        )
      : options;
  const count = selected.length;

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        className={`inline-flex items-center gap-2 h-10 pl-4 pr-3 rounded-full border text-[13px] font-display font-semibold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
          count > 0
            ? "bg-dbz-orange/15 text-dbz-orange border-dbz-orange/50"
            : "bg-white/[0.04] text-white/75 border-white/[0.12] hover:text-white hover:border-white/30"
        }`}
      >
        <span>{label}</span>
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-dbz-orange text-black text-[11px] font-bold">
            {count}
          </span>
        )}
        <svg
          className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable
          // `max-w-[calc(100vw-2rem)]` : sur un écran de 390 px, un panneau de
          // 256 px ancré à un bouton proche du bord droit sortait de l'écran,
          // et la moitié des options devenait injoignable.
          className={`absolute top-[calc(100%+8px)] z-50 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-white/[0.12] bg-[#0c0c0e]/95 backdrop-blur-xl shadow-2xl shadow-black/60 p-2 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {searchable && (
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrer…"
              aria-label={`Filtrer ${label}`}
              className="mb-2 w-full h-9 px-3 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white text-[13px] placeholder:text-white/50 focus:outline-none focus:border-dbz-orange/60"
            />
          )}
          <div className="max-h-72 overflow-y-auto pr-1 space-y-0.5 [scrollbar-width:thin]">
            {shown.length === 0 ? (
              <p className="px-2.5 py-3 text-[12px] text-white/50">
                Aucune option.
              </p>
            ) : (
              shown.map((o) => {
                const on = selected.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(o.value)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-white/[0.06] transition-colors focus-visible:outline-none focus-visible:bg-white/[0.06]"
                  >
                    <span
                      className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors ${
                        on
                          ? "bg-dbz-orange border-dbz-orange"
                          : "border-white/30"
                      }`}
                    >
                      {on && (
                        <svg
                          className="w-3 h-3 text-black"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3.5"
                          aria-hidden
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                    <span
                      className={`flex-1 truncate text-[13px] ${on ? "text-white" : "text-white/70"}`}
                    >
                      {o.label}
                    </span>
                    {o.count != null && (
                      <span className="text-white/50 text-[11px] tabular-nums">
                        {o.count}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {count > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full text-center text-[11px] uppercase tracking-widest font-bold text-white/50 hover:text-dbz-orange py-1.5 transition-colors"
            >
              Tout effacer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
