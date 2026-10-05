"use client";

import { useQuery } from "@tanstack/react-query";
import { Base, Cadenas, Crayon } from "@/components/icones";
import { useRouter } from "next/navigation";
import { api } from "@aphrody/admin-ui/client";

interface TableSpec {
  name: string;
  pk: string;
  readonly: boolean;
  mutableColumns: string[];
  description: string | null;
}

/** Libellés humains pour chaque table technique. */
const TABLE_LABELS: Record<string, { label: string; group: string }> = {
  // Joueurs & économie
  users: { label: "Joueurs", group: "Serveur" },
  inventory: { label: "Inventaires", group: "Serveur" },
  shop_items: { label: "Articles de la boutique", group: "Serveur" },
  achievements: { label: "Succès obtenus", group: "Serveur" },
  achievement_triggers: { label: "Déclencheurs de succès", group: "Serveur" },
  level_rewards: { label: "Récompenses de niveau", group: "Serveur" },
  guild_settings: { label: "Paramètres du serveur", group: "Serveur" },
  warns: { label: "Avertissements", group: "Modération" },
  jails: { label: "Joueurs en prison", group: "Modération" },
  tickets: { label: "Tickets de support", group: "Modération" },
  giveaways: { label: "Giveaways", group: "Serveur" },
  fusions: { label: "Fusions actives", group: "Serveur" },
  action_logs: { label: "Journal des actions", group: "Audit" },
  // Encyclopédie DB
  db_characters: { label: "Personnages", group: "Encyclopédie" },
  db_planets: { label: "Cosmologie", group: "Encyclopédie" },
  db_races: { label: "Races", group: "Encyclopédie" },
  db_transformations: { label: "Transformations", group: "Encyclopédie" },
  db_techniques: { label: "Techniques", group: "Encyclopédie" },
  db_sagas: { label: "Sagas", group: "Encyclopédie" },
  db_arcs: { label: "Arcs narratifs", group: "Encyclopédie" },
  db_episodes: { label: "Épisodes", group: "Encyclopédie" },
  db_movies: { label: "Films", group: "Encyclopédie" },
  db_games: { label: "Jeux vidéo", group: "Encyclopédie" },
  db_manga_volumes: { label: "Tomes manga", group: "Encyclopédie" },
  db_manga_chapters: { label: "Chapitres manga", group: "Encyclopédie" },
  db_manga_pages: { label: "Planches manga (OCR)", group: "Encyclopédie" },
  db_databooks: { label: "Databooks & interviews", group: "Encyclopédie" },
  db_wiki_sections: { label: "Sections wiki", group: "Encyclopédie" },
  db_character_variants: { label: "Versions par saga", group: "Encyclopédie" },
  db_tools: { label: "Outils communautaires", group: "Encyclopédie" },
  db_news: { label: "Actualités", group: "Encyclopédie" },
  db_sources: { label: "Sources & attributions", group: "Médias" },
  db_licenses: { label: "Licences", group: "Médias" },
  db_assets: { label: "Médias & images", group: "Médias" },
};

const GROUP_ORDER = ["Serveur", "Modération", "Encyclopédie", "Médias", "Audit"];

export default function DatabasePage() {
  const router = useRouter();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["db", "tables"],
    queryFn: () => api.get<{ tables: TableSpec[] }>("/database/tables"),
  });

  if (isLoading) {
    return (
      <div className="w-full max-w-6xl mx-auto space-y-6">
        <header className="mb-8">
          <h1 className="text-4xl font-saiyan text-dbz-orange mb-2 uppercase">
            Contenu de l&apos;encyclopédie
          </h1>
          <p className="text-xs text-dbz-blue-light uppercase tracking-widest">
            Chargement des sections…
          </p>
        </header>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="card animate-pulse bg-dbz-card/40 h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="w-full max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-4xl font-saiyan text-dbz-orange mb-2 uppercase">
            Contenu de l&apos;encyclopédie
          </h1>
        </header>
        <div className="dbz-panel p-8 text-center">
          <p className="text-dbz-orange font-saiyan text-xl uppercase mb-2">Connexion impossible</p>
          <p className="text-white/60 text-sm">
            Impossible de joindre le bot. Vérifiez que le service est en ligne.
          </p>
        </div>
      </div>
    );
  }

  const tables = data.tables ?? [];

  // Regrouper par catégorie
  const groups: Record<string, TableSpec[]> = {};
  for (const g of GROUP_ORDER) groups[g] = [];
  for (const t of tables) {
    const g = TABLE_LABELS[t.name]?.group ?? "Autres";
    if (!groups[g]) groups[g] = [];
    groups[g].push(t);
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-10">
      <header className="mb-8">
        <h1 className="text-4xl font-saiyan text-dbz-orange mb-2 uppercase">
          Contenu de l&apos;encyclopédie
        </h1>
        <p className="text-xs text-dbz-blue-light uppercase tracking-widest">
          {tables.length} sections · cliquez pour consulter et modifier les entrées
        </p>
        <p className="mt-2 text-sm text-white/50">
          Chaque section correspond à une catégorie de données du bot. Les sections en lecture seule
          ne peuvent pas être modifiées directement.
        </p>
      </header>

      {GROUP_ORDER.filter((g) => (groups[g]?.length ?? 0) > 0).map((groupName) => (
        <section key={groupName}>
          <h2 className="font-saiyan text-lg text-dbz-yellow uppercase tracking-widest mb-4 border-b border-dbz-yellow/20 pb-2">
            {groupName}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {groups[groupName].map((t) => {
              const meta = TABLE_LABELS[t.name];
              const label = meta?.label ?? t.name;
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => router.push(`/admin/database/${t.name}`)}
                  className="card cursor-pointer text-left transition-colors hover:border-dbz-orange/50 hover:bg-dbz-orange/5 group"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Base className="h-4 w-4 text-dbz-orange/70 group-hover:text-dbz-orange transition-colors" />
                      <span className="font-saiyan text-sm uppercase tracking-wider text-white group-hover:text-dbz-orange transition-colors">
                        {label}
                      </span>
                    </div>
                    {t.readonly && (
                      <span title="Lecture seule" className="inline-flex">
                        <Cadenas className="h-3 w-3 text-white/50" />
                      </span>
                    )}
                  </div>
                  {t.description && <p className="text-xs text-white/50 mb-2">{t.description}</p>}
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className="badge border-dbz-border/60 text-white/50">
                      <code className="font-mono">{t.name}</code>
                    </span>
                    {!t.readonly && t.mutableColumns.length > 0 && (
                      <span className="badge badge-success">
                        <Crayon className="h-2.5 w-2.5" />
                        {t.mutableColumns.length} champ
                        {t.mutableColumns.length > 1 ? "s" : ""} modifiable
                        {t.mutableColumns.length > 1 ? "s" : ""}
                      </span>
                    )}
                    {t.readonly && (
                      <span className="badge border-white/20 text-white/50">lecture seule</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
