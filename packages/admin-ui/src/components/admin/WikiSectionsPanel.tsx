"use client";

/**
 * Gestion des **sections de contenu** d'une entité wiki depuis le studio
 * (`bot.db_wiki_sections`) : blocs markdown nommés (« Histoire », « Personnalité »,
 * « Anecdotes », « PWS »…) qui composent le sélecteur de catégories de la fiche
 * publique. Ajout par preset ou libellé libre, réordonnancement, masquage
 * individuel, édition riche (MarkdownField) et suppression.
 *
 * Écrit via le CRUD wiki (`/api/wiki-admin/db_wiki_sections`) — la page publique
 * lit `getWikiSections` (server-only). Monté uniquement en mode édition (l'entité
 * doit exister pour porter des sections).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Chargement,
  ChevronBas,
  ChevronHaut,
  Corbeille,
  Couches,
  Croix,
  Enregistrer,
  Lien,
  Oeil,
  OeilBarre,
  Plus,
  Recherche,
} from "@/components/icones";
import { useMemo, useState } from "react";
import { MarkdownField } from "@aphrody/admin-ui/components/admin/MarkdownField";
import { apiAt } from "@aphrody/admin-ui/client";
import { assetUrl } from "@/lib/assets";
import { SECTION_ACCENT_OPTIONS } from "@/lib/wiki-section-accents";
import {
  PWS_GROUP_PRESETS,
  publicEntityUrl,
  SECTION_PRESETS,
  sectionKeyFromLabel,
  uploadSubdir,
} from "@/lib/wiki-fields";
import { crudBase } from "@/lib/wiki-tables";

/** Carte « page wiki affiliée » (miroir client de WikiSectionLink de bot-schema). */
interface SectionLink {
  href: string;
  label: string;
  image?: string;
  sub?: string;
}

interface Section {
  id: number;
  entityType: string;
  entityId: number;
  key: string;
  label: string;
  accent: string | null;
  body: string | null;
  groupLabel: string | null;
  links: SectionLink[] | null;
  sortOrder: number;
  visible: boolean;
}

/** Types d'entités liables (table → libellé). */
const LINKABLE_ENTITIES: {
  table: string;
  label: string;
  nameCol: string;
  imageCol: string;
}[] = [
  {
    table: "db_characters",
    label: "Personnages",
    nameCol: "name",
    imageCol: "image",
  },
  {
    table: "db_planets",
    label: "Cosmologie",
    nameCol: "name",
    imageCol: "image",
  },
  {
    table: "db_techniques",
    label: "Techniques",
    nameCol: "name",
    imageCol: "image",
  },
  {
    table: "db_transformations",
    label: "Transformations",
    nameCol: "name",
    imageCol: "image",
  },
  { table: "db_races", label: "Races", nameCol: "name", imageCol: "image" },
  { table: "db_sagas", label: "Sagas", nameCol: "name", imageCol: "image" },
  { table: "db_arcs", label: "Arcs", nameCol: "name", imageCol: "image" },
  { table: "db_games", label: "Jeux", nameCol: "name", imageCol: "image" },
  { table: "db_movies", label: "Films", nameCol: "title", imageCol: "image" },
];

const ACCENTS = SECTION_ACCENT_OPTIONS;

export function WikiSectionsPanel({
  table,
  entityId,
  entityType,
}: {
  table: string;
  entityId: string;
  entityType: string;
}) {
  const qc = useQueryClient();
  const client = apiAt(crudBase("db_wiki_sections"));
  const [customLabel, setCustomLabel] = useState("");

  const key = ["wiki-sections", entityType, entityId];
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      client.get<{ items: Section[] }>(
        `/db_wiki_sections?as=sectionsFor&entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      ),
  });
  // Mémoïsé : le littéral `[]` du repli changeait d'identité à chaque rendu, si
  // bien que la dépendance de `groupNames` était toujours neuve et que son
  // useMemo ne mémoïsait rien — c'est ce que signalait react-hooks/exhaustive-deps.
  const sections = useMemo(() => query.data?.items ?? [], [query.data]);
  // Sous-catégories déjà utilisées → suggestions (datalist) dans chaque éditeur.
  const groupNames = useMemo(
    () =>
      Array.from(
        new Set(
          sections
            .map((s) => s.groupLabel?.trim())
            .filter((g): g is string => !!g),
        ),
      ).toSorted(),
    [sections],
  );

  const add = useMutation({
    mutationFn: (preset: {
      key: string;
      label: string;
      accent: string;
      groupLabel?: string;
      sortOrder?: number;
    }) =>
      client.post(`/db_wiki_sections`, {
        entityType,
        entityId,
        key: preset.key,
        label: preset.label,
        accent: preset.accent,
        groupLabel: preset.groupLabel?.trim() || null,
        body: "",
        sortOrder: preset.sortOrder ?? sections.length,
      }),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: async (orderedIds: number[]) => {
      await Promise.all(
        orderedIds.map((id, i) =>
          client.patch(`/db_wiki_sections/${id}`, { sortOrder: i }),
        ),
      );
    },
    onSuccess: invalidate,
  });

  function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= sections.length) return;
    const ids = sections.map((s) => s.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    reorder.mutate(ids);
  }

  function addCustom() {
    const label = customLabel.trim();
    if (!label) return;
    add.mutate({ key: sectionKeyFromLabel(label), label, accent: "orange" });
    setCustomLabel("");
  }

  async function addPwsPack() {
    const base = sections.length;
    try {
      for (const [i, preset] of PWS_GROUP_PRESETS.entries()) {
        await add.mutateAsync({ ...preset, sortOrder: base + i });
      }
    } catch {
      // L'échec est déjà rendu par `add.isError`. Sans ce filet, le rejet de
      // `mutateAsync` remontait en promesse non gérée : le `void` de l'appelant
      // ne l'attrape pas.
    }
  }

  return (
    <div className="dbz-panel space-y-4 p-5">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
        <Couches className="h-3.5 w-3.5" /> Sections de contenu
        <span className="text-white/50">({sections.length})</span>
        {(query.isFetching || reorder.isPending || add.isPending) && (
          <Chargement className="h-3 w-3 animate-spin text-white/50" />
        )}
      </div>

      <p className="text-xs text-white/50">
        Blocs affichés en catégories sélectionnables sur la fiche (« Histoire »,
        « Personnalité », « Anecdotes », « PWS »…). Dès qu&apos;une fiche a des
        sections ici, elles définissent
        <strong className="text-white/70"> seules</strong> ses catégories (le
        champ « Article » n&apos;est plus affiché) : masquage, ordre et édition
        font foi. Techniques et transformations restent gérées dans « Relations
        ».
      </p>

      {query.isError ? (
        <p className="text-xs text-red-400">Chargement des sections échoué.</p>
      ) : sections.length === 0 ? (
        <p className="text-xs italic text-white/50">
          Aucune section pour l&apos;instant.
        </p>
      ) : (
        <div className="space-y-2">
          {sections.map((s, i) => (
            <SectionRow
              key={s.id}
              section={s}
              table={table}
              groups={groupNames}
              isFirst={i === 0}
              isLast={i === sections.length - 1}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}

      {/* Ajout rapide */}
      <div className="space-y-2 border-t border-white/10 pt-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={add.isPending}
            onClick={() => void addPwsPack()}
            className="inline-flex items-center gap-1 rounded border border-dbz-red/40 bg-dbz-red/10 px-2 py-1 text-xs font-semibold text-dbz-red transition-colors hover:border-dbz-red hover:bg-dbz-red/20 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" /> Pack PWS
          </button>
          {SECTION_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              disabled={add.isPending}
              onClick={() => add.mutate(p)}
              className="inline-flex items-center gap-1 rounded border border-dbz-border bg-dbz-card/60 px-2 py-1 text-xs text-white/80 transition-colors hover:border-dbz-orange hover:text-white disabled:opacity-50"
            >
              <Plus className="h-3 w-3" /> {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1 text-sm"
            placeholder="Section personnalisée…"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={add.isPending || !customLabel.trim()}
            className="btn btn-ghost shrink-0"
          >
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        </div>
        {add.isError && (
          <p className="text-xs text-red-400">Ajout échoué. Réessaie.</p>
        )}
      </div>
    </div>
  );
}

function SectionRow({
  section,
  table,
  groups,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onChanged,
}: {
  section: Section;
  table: string;
  groups: string[];
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChanged: () => void;
}) {
  const client = apiAt(crudBase("db_wiki_sections"));
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(section.label);
  const [accent, setAccent] = useState(section.accent ?? "orange");
  const [body, setBody] = useState(section.body ?? "");
  const [groupLabel, setGroupLabel] = useState(section.groupLabel ?? "");
  const [links, setLinks] = useState<SectionLink[]>(section.links ?? []);

  const dirty =
    label !== section.label ||
    accent !== (section.accent ?? "orange") ||
    body !== (section.body ?? "") ||
    groupLabel !== (section.groupLabel ?? "") ||
    JSON.stringify(links) !== JSON.stringify(section.links ?? []);

  const save = useMutation({
    mutationFn: () =>
      client.patch(`/db_wiki_sections/${section.id}`, {
        label,
        accent,
        body,
        groupLabel: groupLabel.trim() || null,
        links,
      }),
    onSuccess: onChanged,
  });
  const toggleVisible = useMutation({
    mutationFn: () =>
      client.patch(`/db_wiki_sections/${section.id}`, {
        visible: !section.visible,
      }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => client.delete(`/db_wiki_sections/${section.id}`),
    onSuccess: onChanged,
  });

  const dot =
    ACCENTS.find((a) => a.key === (section.accent ?? "orange"))?.dot ??
    "bg-dbz-orange";

  return (
    <div className="rounded border border-dbz-border bg-dbz-card/40">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-white/90 hover:text-dbz-orange"
        >
          {section.groupLabel?.trim() && (
            <span className="mr-2 inline-flex items-center gap-1 rounded bg-dbz-blue-light/15 px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wider text-dbz-blue-light">
              <Couches className="h-2.5 w-2.5" />
              {section.groupLabel}
            </span>
          )}
          {section.label}
          {(section.links?.length ?? 0) > 0 && (
            <span className="ml-2 inline-flex items-center gap-0.5 align-middle text-[10px] text-white/50">
              <Lien className="h-3 w-3" />
              {section.links?.length}
            </span>
          )}
          {!section.visible && (
            <span className="ml-2 text-[10px] uppercase tracking-widest text-white/50">
              masquée
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-0.5 text-white/50">
          <button
            type="button"
            title="Monter"
            aria-label={`Monter la section « ${section.label} »`}
            disabled={isFirst}
            onClick={onMoveUp}
            className="rounded p-1 hover:text-white disabled:opacity-25"
          >
            <ChevronHaut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Descendre"
            aria-label={`Descendre la section « ${section.label} »`}
            disabled={isLast}
            onClick={onMoveDown}
            className="rounded p-1 hover:text-white disabled:opacity-25"
          >
            <ChevronBas className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={section.visible ? "Masquer" : "Afficher"}
            aria-label={`${section.visible ? "Masquer" : "Afficher"} la section « ${section.label} »`}
            onClick={() => toggleVisible.mutate()}
            className="rounded p-1 hover:text-white"
          >
            {section.visible ? (
              <Oeil className="h-3.5 w-3.5" />
            ) : (
              <OeilBarre className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            title="Supprimer"
            aria-label={`Supprimer la section « ${section.label} »`}
            onClick={() => {
              if (window.confirm(`Supprimer la section « ${section.label} » ?`))
                remove.mutate();
            }}
            className="rounded p-1 text-red-400 hover:text-red-300"
          >
            <Corbeille className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded p-1 hover:text-white"
            title={open ? "Replier" : "Éditer"}
            aria-label={`${open ? "Replier" : "Éditer"} la section « ${section.label} »`}
            aria-expanded={open}
          >
            {open ? (
              <ChevronHaut className="h-4 w-4" />
            ) : (
              <ChevronBas className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-white/10 p-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex-1">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/50">
                Titre
              </span>
              <input
                className="input text-sm"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/50">
                Accent
              </span>
              <select
                className="input text-sm"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
              >
                {ACCENTS.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/50">
                Groupe parent (onglet)
              </span>
              <input
                className="input text-sm"
                list="wiki-section-groups"
                placeholder="ex. PWS"
                value={groupLabel}
                onChange={(e) => setGroupLabel(e.target.value)}
              />
              <datalist id="wiki-section-groups">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
          </div>
          <p className="text-[11px] text-white/50 -mt-1">
            Le <strong className="text-white/60">groupe parent</strong> devient
            l&apos;onglet de la barre du haut (ex. « PWS »). Le{" "}
            <strong className="text-white/60">titre</strong> ci-dessus est la
            sous-section affichée en dessous (ex. « Vitesse », « Puissance
            d&apos;attaque »). Laisse vide pour une catégorie de 1er niveau («
            Histoire », « Anecdotes »…).
          </p>
          <MarkdownField
            value={body}
            onChange={setBody}
            subdir={uploadSubdir(table)}
            preview={false}
          />
          <WikiSectionLinksEditor links={links} onChange={setLinks} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || !dirty}
              className="btn btn-primary"
            >
              <Enregistrer className="h-4 w-4" />
              {save.isPending ? "Enregistrement…" : "Enregistrer la section"}
            </button>
            {save.isError && (
              <span className="text-xs text-red-400">
                Échec de l&apos;enregistrement.
              </span>
            )}
            {save.isSuccess && !dirty && (
              <span className="text-xs text-green-400">Enregistré.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Ligne brute renvoyée par le CRUD wiki (colonnes camelCase). */
type EntityRow = Record<string, unknown> & {
  id?: number | string;
  slug?: string;
};

/**
 * Éditeur de « pages wiki affiliées » d'une section : chaque lien = une carte
 * (photo + libellé) vers une autre fiche wiki. Sélection par type d'entité +
 * recherche ; l'ajout résout href (URL publique) + image (assetUrl) + libellé.
 */
function WikiSectionLinksEditor({
  links,
  onChange,
}: {
  links: SectionLink[];
  onChange: (next: SectionLink[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [table, setTable] = useState(LINKABLE_ENTITIES[0].table);
  const [q, setQ] = useState("");
  const spec =
    LINKABLE_ENTITIES.find((e) => e.table === table) ?? LINKABLE_ENTITIES[0];
  const client = apiAt(crudBase(table));

  const list = useQuery({
    queryKey: ["wiki-link-pick", table],
    enabled: picking,
    staleTime: 5 * 60_000,
    queryFn: () => client.get<{ rows: EntityRow[] }>(`/${table}?limit=1000`),
  });

  const results = useMemo(() => {
    const rows = list.data?.rows ?? [];
    const needle = q.trim().toLowerCase();
    const named = rows
      .map((r) => ({
        row: r,
        name: String(r[spec.nameCol] ?? "").trim(),
      }))
      .filter(
        (x) => x.name && (!needle || x.name.toLowerCase().includes(needle)),
      );
    return named.slice(0, 40);
  }, [list.data, q, spec.nameCol]);

  function add(row: EntityRow, name: string) {
    const href = publicEntityUrl(table, row);
    if (!href) return;
    const rawImg = row[spec.imageCol];
    const image =
      typeof rawImg === "string" && rawImg ? assetUrl(rawImg) : undefined;
    if (links.some((l) => l.href === href)) return; // pas de doublon
    onChange([...links, { href, label: name, image }]);
  }

  return (
    <div className="rounded border border-dbz-border bg-dbz-card/30 p-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
        <Lien className="h-3.5 w-3.5" /> Pages wiki liées
        <span className="text-white/50">({links.length})</span>
      </div>
      <p className="mb-2 text-[11px] text-white/50">
        Cartes avec photo renvoyant vers d&apos;autres fiches wiki (ex. affilier
        des personnages à une catégorie « Powerscaling »).
      </p>

      {links.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {links.map((l, i) => (
            <div
              key={`${l.href}-${i}`}
              className="group relative flex items-center gap-2 rounded border border-dbz-border bg-dbz-bg/60 p-1.5"
            >
              {l.image ? (
                <img
                  src={l.image}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="h-9 w-9 shrink-0 rounded bg-dbz-card" />
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-white/85">
                {l.label}
              </span>
              <button
                type="button"
                title="Retirer"
                aria-label={`Retirer le lien vers ${l.label}`}
                onClick={() => onChange(links.filter((_, j) => j !== i))}
                className="rounded p-1 text-red-400 opacity-70 hover:opacity-100"
              >
                <Croix className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {picking ? (
        <div className="space-y-2 rounded border border-dbz-border bg-dbz-bg/40 p-2">
          <div className="flex gap-2">
            <select
              className="input text-xs"
              aria-label="Type de fiche à lier"
              value={table}
              onChange={(e) => {
                setTable(e.target.value);
                setQ("");
              }}
            >
              {LINKABLE_ENTITIES.map((e) => (
                <option key={e.table} value={e.table}>
                  {e.label}
                </option>
              ))}
            </select>
            <div className="relative flex-1">
              <Recherche className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" />
              <input
                className="input pl-7 text-xs"
                aria-label="Rechercher une fiche à lier"
                placeholder="Rechercher une fiche…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
              />
            </div>
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="btn btn-ghost shrink-0"
            >
              Fermer
            </button>
          </div>
          {list.isLoading ? (
            <p className="py-3 text-center text-xs text-white/50">
              <Chargement className="mr-1 inline h-3 w-3 animate-spin" />{" "}
              Chargement…
            </p>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {results.length === 0 ? (
                <p className="py-2 text-center text-xs italic text-white/50">
                  Aucun résultat.
                </p>
              ) : (
                results.map(({ row, name }) => {
                  const rawImg = row[spec.imageCol];
                  const img =
                    typeof rawImg === "string" && rawImg
                      ? assetUrl(rawImg)
                      : null;
                  const already = links.some(
                    (l) => l.href === publicEntityUrl(table, row),
                  );
                  return (
                    <button
                      key={String(row.id)}
                      type="button"
                      disabled={already || !publicEntityUrl(table, row)}
                      onClick={() => add(row, name)}
                      className="flex w-full items-center gap-2 rounded p-1 text-left hover:bg-white/5 disabled:opacity-40"
                    >
                      {img ? (
                        <img
                          src={img}
                          alt=""
                          className="h-8 w-8 rounded object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded bg-dbz-card" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs text-white/85">
                        {name}
                      </span>
                      {already ? (
                        <span className="text-[9px] uppercase text-white/50">
                          ajouté
                        </span>
                      ) : (
                        <Plus className="h-3.5 w-3.5 text-dbz-orange" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="btn btn-ghost"
        >
          <Plus className="h-4 w-4" /> Lier une page wiki
        </button>
      )}
    </div>
  );
}
