// Source: apps/shenron/site/src/components/editor/PlainField.tsx at 8172f535ce (preserved Git history).
"use client";

/**
 * Champ de **texte simple** du module — le remplaçant unique des `<textarea>`
 * dispersés dans le site (commentaires, signalements, avis, champs d'admin).
 *
 * Ce n'est pas un éditeur riche, et c'est délibéré : là où le contenu est du
 * texte brut, en ajouter un compliquerait la saisie sans rien apporter. En
 * revanche il règle tout ce qu'une zone de texte nue laissait au hasard :
 *
 *   - hauteur qui suit le contenu (plus de barre de défilement à 3 lignes) ;
 *   - compteur de caractères qui prévient **avant** la limite ;
 *   - `Ctrl/⌘ + ⏎` pour envoyer, annonce du reste à écrire aux lecteurs d'écran ;
 *   - 16 px de police sur mobile — en dessous, iOS zoome à chaque focus ;
 *   - autosauvegarde locale facultative (un commentaire perdu ne se réécrit pas).
 */
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@shenron/ui/lib/utils";

export type PlainFieldProps = {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  name?: string;
  label?: string;
  /** Masque le libellé visuellement mais le garde pour les lecteurs d'écran. */
  hideLabel?: boolean;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  minRows?: number;
  maxRows?: number;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  monospace?: boolean;
  /** Clé de sauvegarde locale (brouillon anti-perte). */
  draftKey?: string;
  className?: string;
  autoFocus?: boolean;
  spellCheck?: boolean;
  id?: string;
};

const DRAFT_PREFIX = "shenron-field-draft:";

export function PlainField({
  value,
  defaultValue = "",
  onChange,
  onSubmit,
  name,
  label,
  hideLabel,
  placeholder,
  hint,
  maxLength,
  minRows = 3,
  maxRows = 16,
  required,
  disabled,
  readOnly,
  monospace,
  draftKey,
  className,
  spellCheck = true,
  id,
}: PlainFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [internal, setInternal] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : internal;

  // Reprise d'un brouillon local (uniquement si le champ est encore vide :
  // jamais écraser ce que l'utilisateur ou le serveur a déjà mis).
  useEffect(() => {
    if (!draftKey || current) return;
    try {
      const saved = localStorage.getItem(DRAFT_PREFIX + draftKey);
      if (saved) {
        setInternal(saved);
        onChange?.(saved);
      }
    } catch {
      // Stockage indisponible : sans importance.
    }
    // Au montage seulement.
  }, [draftKey]);

  // Hauteur automatique. `field-sizing: content` fait le travail sur les
  // navigateurs récents ; le calcul manuel couvre les autres.
  useEffect(() => {
    const el = ref.current;
    if (!el || CSS.supports?.("field-sizing", "content")) return;
    el.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * maxRows)}px`;
  }, [current, maxRows]);

  const update = (next: string) => {
    if (!controlled) setInternal(next);
    onChange?.(next);
    if (draftKey) {
      try {
        if (next.trim()) localStorage.setItem(DRAFT_PREFIX + draftKey, next);
        else localStorage.removeItem(DRAFT_PREFIX + draftKey);
      } catch {
        // sans importance
      }
    }
  };

  const remaining = maxLength ? maxLength - current.length : null;
  const nearLimit = remaining !== null && remaining <= Math.max(20, (maxLength ?? 0) * 0.1);

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <label
          htmlFor={fieldId}
          className={cn(
            "mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/50",
            hideLabel && "sr-only",
          )}
        >
          {label}
          {required && <span className="ml-1 text-dbz-orange">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        id={fieldId}
        name={name}
        value={current}
        onChange={e => update(e.target.value)}
        onKeyDown={e => {
          // Envoi au clavier : le geste attendu dans un champ multiligne.
          if (onSubmit && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        rows={minRows}
        maxLength={maxLength}
        required={required}
        disabled={disabled}
        readOnly={readOnly}

        spellCheck={spellCheck}
        aria-describedby={hint || maxLength ? `${fieldId}-desc` : undefined}
        className={cn(
          "field-sizing-content w-full resize-y rounded-lg border border-white/12 bg-black/30 px-3 py-2.5",
          // 16 px sur mobile : en dessous, iOS zoome à chaque prise de focus.
          "text-[16px] leading-relaxed text-white outline-none transition-colors md:text-[14px]",
          "placeholder:text-white/30 focus:border-dbz-orange disabled:opacity-50",
          monospace && "font-mono text-[13px]",
        )}
        style={{ maxHeight: `${maxRows * 1.6}em` }}
      />
      {(hint || maxLength) && (
        <div id={`${fieldId}-desc`} className="mt-1 flex items-center justify-between gap-3 text-[11px]">
          <span className="text-white/45">{hint}</span>
          {maxLength && (
            <span
              aria-live={nearLimit ? "polite" : "off"}
              className={cn("shrink-0 tabular-nums", nearLimit ? "text-amber-300" : "text-white/35")}
            >
              {current.length} / {maxLength}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
