"use client";

/**
 * Aperçu live d'une entité wiki (`db_*`) tel qu'il apparaîtra sur la page
 * publique : héro image + titre (FR/JP/romaji) + chips de stats + description
 * rendue en markdown. Générique — s'adapte aux colonnes présentes via
 * `fieldRoles()`. Piloté par le brouillon du studio, se met à jour à la frappe.
 */
import { WikiMarkdown } from "@/components/wiki/WikiMarkdown";
import { assetUrl } from "@/lib/assets";
import { colLabel } from "../../lib/db-labels";
import { fieldRoles, isBoolColumn } from "@/lib/wiki-fields";

interface Props {
  table: string;
  /** Valeurs courantes du formulaire (camelCase → string). */
  draft: Record<string, string>;
}

/** Champs jamais affichés en chip (clés internes, URLs, dates, techniques). */
const HIDDEN_CHIP = /(^id$|Id$|^slug$|^orderIdx$|Idx$|^malId$|anilistId|^isbn$|url$|Url$|date|At$)/i;

export function WikiEntityPreview({ table, draft }: Props) {
  const cols = Object.keys(draft);
  const roles = fieldRoles(cols);

  const val = (k?: string) => (k ? (draft[k] ?? "").trim() : "");
  const image = val(roles.image);
  const title = val(roles.title);
  const ja = val(roles.titleJa);
  const romaji = val(roles.titleRomaji);
  const description = val(roles.description);
  const ki = val("ki");
  const maxKi = val("maxKi");

  const used = new Set(
    [roles.image, roles.title, roles.titleJa, roles.titleRomaji, roles.description, "ki", "maxKi"].filter(
      Boolean,
    ) as string[],
  );
  // Chips : champs scalaires restants, non vides, non techniques. Les booléens
  // sont rendus Oui/Non (pas la string brute "true"/"false").
  const chips = cols
    .filter(c => !used.has(c) && !HIDDEN_CHIP.test(c) && val(c) !== "")
    .map(c => {
      const raw = val(c);
      const value = isBoolColumn(c) ? (raw === "true" || raw === "1" ? "Oui" : "Non") : raw;
      return { key: c, label: colLabel(c), value };
    });

  const isEmpty = !image && !title && !description && chips.length === 0 && !ki && !maxKi;

  if (isEmpty) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 text-center">
        <span className="font-saiyan text-2xl uppercase text-white/15">Aperçu de la page</span>
        <p className="max-w-xs text-sm text-white/50">
          Remplis les champs à gauche : l&apos;aperçu de la page wiki se construit ici en temps réel.
        </p>
      </div>
    );
  }

  return (
    <article className="space-y-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        {/* Héro image */}
        {image && (
          <div className="w-full shrink-0 sm:w-2/5">
            <div className="dbz-panel group relative overflow-hidden border-2 border-dbz-orange/30 bg-dbz-card p-4">
              <div className="halftone absolute inset-0 opacity-20" />
              <img
                key={image}
                src={assetUrl(image)}
                alt={title || ""}
                className="relative z-10 h-auto w-full object-contain drop-shadow-[0_0_15px_rgba(255,178,0,0.3)]"
                onError={e => {
                  (e.currentTarget as HTMLImageElement).style.opacity = "0.15";
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-dbz-orange/10 to-transparent" />
            </div>
          </div>
        )}

        {/* Titre + identité */}
        <div className="min-w-0 flex-1 space-y-4">
          <h1 className="break-words font-saiyan text-3xl uppercase leading-none text-white sm:text-4xl lg:text-5xl">
            {title || <span className="text-white/25">Sans titre</span>}
          </h1>
          {(ja || romaji) && (
            <div className="flex flex-wrap items-center gap-3">
              {ja && <span className="text-xl font-bold tracking-widest text-dbz-orange">{ja}</span>}
              {romaji && <span className="text-xs uppercase italic tracking-[0.2em] text-white/50">{romaji}</span>}
            </div>
          )}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map(c => (
                <span
                  key={c.key}
                  className="border border-dbz-orange/30 bg-dbz-orange/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-dbz-orange/90"
                  title={c.label}
                >
                  <span className="text-white/50">{c.label}</span> <span className="text-white/90">{c.value}</span>
                </span>
              ))}
            </div>
          )}
          {(ki || maxKi) && (
            <div className="grid grid-cols-2 gap-3">
              {ki && <KiCard label="Ki" value={ki} />}
              {maxKi && <KiCard label="Ki max" value={maxKi} />}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {description && (
        <div className="dbz-panel relative p-6">
          <div className="absolute left-0 top-0 h-full w-1 bg-dbz-orange" />
          <h3 className="mb-3 font-saiyan text-xl uppercase tracking-widest text-dbz-orange">Description</h3>
          <div className="prose prose-invert wiki-content max-w-none text-justify text-sm">
            <WikiMarkdown body={description} />
          </div>
        </div>
      )}
      <p className="text-center text-[10px] uppercase tracking-[0.3em] text-white/20">Aperçu — {table}</p>
    </article>
  );
}

function KiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="dbz-panel border-l-4 border-l-dbz-orange p-4">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">{label}</p>
      <p className="scouter-text break-words text-2xl text-dbz-orange">{value}</p>
    </div>
  );
}
