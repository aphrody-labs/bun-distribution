"use client";

import { useState, useMemo, useEffect, type ReactNode } from "react";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { UiLinkComponent } from "../navigation/link";

export type AdminSidebarLink = {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
  section: string;
};
export type AdminSidebarSection = {
  id: string;
  label: string;
  description: string;
};
export type AdminSidebarViewProps = {
  pathname: string;
  links: readonly AdminSidebarLink[];
  sections: readonly AdminSidebarSection[];
  linkComponent?: UiLinkComponent;
  initialSection?: string;
  brand?: string;
  homeHref?: string;
};
type SectionId = string;
export function AdminSidebarView({
  pathname,
  links,
  sections,
  linkComponent: Link = "a",
  initialSection = sections[0]?.id,
  brand = "Administration",
  homeHref = "/",
}: AdminSidebarViewProps) {
  const [open, setOpen] = useState(false); // tiroir mobile
  const [collapsed, setCollapsed] = useState(false); // repli desktop (mode icônes)
  const [q, setQ] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<SectionId>>(
    () => new Set(initialSection ? [initialSection] : []),
  );

  // Restaure l'état replié depuis localStorage au montage
  useEffect(() => {
    setCollapsed(localStorage.getItem("admin-sidebar-collapsed") === "1");
  }, []);

  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("admin-sidebar-collapsed", next ? "1" : "0");
      if (next) setQ(""); // la recherche est masquée en mode replié
      return next;
    });

  const filtered = useMemo(() => {
    if (!q.trim()) return links;
    const needle = q.trim().toLowerCase();
    return links.filter(
      (l) =>
        l.label.toLowerCase().includes(needle) ||
        l.description.toLowerCase().includes(needle) ||
        l.href.toLowerCase().includes(needle),
    );
  }, [q, links]);

  const grouped = useMemo(
    () =>
      sections
        .map(({ id }) => {
          const config = sections.find((s) => s.id === id);
          return {
            id,
            label: config?.label ?? id,
            items: filtered.filter((l) => l.section === id),
          };
        })
        .filter((g) => g.items.length > 0),
    [filtered, sections],
  );

  // Une seule entrée active, même pour les routes imbriquées. Sans le match le
  // plus long, `/admin/canvas/themes` activait aussi `/admin/canvas` et les
  // sous-pages du studio allumaient plusieurs repères à la fois.
  const activeHref = useMemo(
    () =>
      links
        .filter(
          (link) =>
            pathname === link.href || pathname?.startsWith(`${link.href}/`),
        )
        .toSorted((a, b) => b.href.length - a.href.length)[0]?.href,
    [pathname, links],
  );

  useEffect(() => {
    const activeSection = links.find(
      (link) => link.href === activeHref,
    )?.section;
    if (!activeSection) return;
    setExpandedSections((current) => new Set(current).add(activeSection));
  }, [activeHref, links]);

  const toggleSection = (section: SectionId) =>
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  return (
    <>
      {/* Barre mobile — bouton d'ouverture du tiroir */}
      <div className="sticky top-16 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-white/10 bg-[#171717]/95 px-4 backdrop-blur min-[600px]:hidden">
        <span className="text-sm font-semibold tracking-tight text-white">
          Administration
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-h-12 rounded-xl bg-blue-500 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
          aria-expanded={open}
          aria-label={open ? "Fermer le menu admin" : "Ouvrir le menu admin"}
        >
          {open ? "Fermer" : "Menu"}
        </button>
      </div>

      {/*
			  Desktop : sticky sous le SiteNav global (h-16) → top-16 + hauteur
			  réelle calc(100vh-4rem) avec scroll interne sur le <nav> (toutes les
			  sections restent atteignables). Repliable en mode icônes (md:w-16).
			  Mobile : tiroir plein largeur piloté par `open`.
			*/}
      <aside
        className={`${collapsed ? "min-[600px]:w-[72px]" : "min-[600px]:w-[304px]"} relative z-20 w-full shrink-0 border-b border-white/10 bg-[#171717] min-[600px]:sticky min-[600px]:top-16 min-[600px]:h-[calc(100vh-4rem)] min-[600px]:border-b-0 min-[600px]:border-r transition-[width] duration-200 ${
          open ? "block" : "hidden min-[600px]:block"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="shrink-0 border-b border-white/10 px-4 py-5 min-[600px]:px-5">
            {collapsed ? (
              <div className="hidden flex-col items-center gap-3 min-[600px]:flex">
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  title="Déplier le menu"
                  aria-label="Déplier le menu"
                  className="grid h-12 w-12 place-items-center rounded-xl text-white/60 transition-colors hover:bg-white/[.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300"
                >
                  <PanelLeftOpen className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold tracking-tight text-white">
                      {brand}
                    </p>
                    <p className="mt-0.5 text-xs text-white/50">
                      Espace administrateur
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleCollapsed}
                    title="Replier le menu"
                    aria-label="Replier le menu"
                    className="hidden h-10 w-10 items-center justify-center rounded-xl text-white/50 transition-colors hover:bg-white/[.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 min-[600px]:inline-flex"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-4">
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Rechercher dans l’administration"
                    className="h-12 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 text-sm text-white placeholder:text-white/40 outline-none transition-colors focus:border-blue-400 focus:bg-white/[.06] focus:ring-2 focus:ring-blue-400/20"
                    aria-label="Filtrer le menu"
                  />
                </div>
              </>
            )}
          </div>

          {/* Navigation par sections — flex-1 + scroll interne */}
          <nav
            className="flex-1 space-y-6 overflow-y-auto px-3 py-4 min-[600px]:px-4"
            aria-label="Navigation admin"
          >
            {grouped.length === 0 ? (
              <p className="px-2 text-sm text-white/50">
                Aucune section ne correspond à &laquo;&nbsp;{q}&nbsp;&raquo;.
              </p>
            ) : (
              grouped.map((group) => (
                <div key={group.id} className="space-y-1.5">
                  {/* Les familles limitent la densité visuelle ; la recherche ouvre tous les résultats. */}
                  {collapsed ? (
                    <div className="mx-2 my-2 hidden h-px bg-white/10 min-[600px]:block" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleSection(group.id)}
                      aria-expanded={
                        q.trim() ? true : expandedSections.has(group.id)
                      }
                      className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-white/[.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300"
                    >
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">
                        {group.label}
                      </span>
                      <span className="h-px flex-1 bg-white/10" />
                      <span className="text-xs tabular-nums text-white/35">
                        {String(group.items.length).padStart(2, "0")}
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 text-white/40 transition-transform ${
                          q.trim() || expandedSections.has(group.id)
                            ? "rotate-180"
                            : ""
                        }`}
                      />
                    </button>
                  )}

                  {(collapsed ||
                    q.trim() ||
                    expandedSections.has(group.id)) && (
                    <ul className="space-y-1">
                      {group.items.map((l) => {
                        const active = activeHref === l.href;
                        return (
                          <li key={l.href}>
                            <Link
                              href={l.href}
                              onClick={() => setOpen(false)}
                              title={
                                collapsed
                                  ? `${l.label} — ${l.description}`
                                  : l.description
                              }
                              aria-current={active ? "page" : undefined}
                              className={`group relative flex min-h-12 items-center gap-3 rounded-xl px-2.5 py-2 transition-colors ${
                                collapsed
                                  ? "min-[600px]:justify-center min-[600px]:gap-0"
                                  : ""
                              } ${
                                active
                                  ? "bg-blue-500/15 text-white"
                                  : "text-white/75 hover:bg-white/[.07] hover:text-white"
                              }`}
                            >
                              {/* Icône */}
                              <span
                                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors ${
                                  active
                                    ? "bg-blue-400/20 text-blue-200"
                                    : "bg-white/[.06] text-white/55 group-hover:bg-white/[.10] group-hover:text-white/80"
                                }`}
                                aria-hidden
                              >
                                {l.icon}
                              </span>

                              {/* Libellé + description — masqués en mode replié (desktop) */}
                              <div
                                className={`flex-1 min-w-0 ${collapsed ? "min-[600px]:hidden" : ""}`}
                              >
                                <span
                                  className={`block text-sm font-medium leading-tight transition-colors ${
                                    active
                                      ? "text-white"
                                      : "text-white/85 group-hover:text-white"
                                  }`}
                                >
                                  {l.label}
                                </span>
                                <span className="mt-0.5 block truncate text-xs leading-tight text-white/45">
                                  {l.description}
                                </span>
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))
            )}
          </nav>

          {/* Pied de page */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/10 px-4 py-4 min-[600px]:px-5">
            <Link
              href={homeHref}
              title="Retour au site"
              className="text-sm text-white/55 transition-colors hover:text-white"
            >
              {collapsed ? <span aria-hidden>&larr;</span> : "← Retour au site"}
            </Link>
            {!collapsed && (
              <span className="text-xs text-white/35">
                {links.length} rubriques
              </span>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
