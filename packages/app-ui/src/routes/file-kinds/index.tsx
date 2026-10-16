// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright 2026 Spacedrive Technology Inc.
// Adapted from the archived FSL Drive view:
// drive/packages/interface/src/routes/file-kinds/index.tsx.
// The source remains in the archive with its provenance and license notices.

import { getIcon } from "@aphrody/assets/util";
import type {
  ContentKind,
  ContentKindStatsInput,
  ContentKindStatsOutput,
  SearchFilters,
} from "@aphrody/drive-client";
import {
  Button,
  Icon,
  m3FocusRing,
  m3StateLayer,
} from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { useEffect } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useNormalizedQuery } from "../../contexts/SpacedriveContext";
import { ExplorerView } from "../explorer/ExplorerView";
import { useExplorer } from "../explorer/context";

const CONTENT_KIND_ICONS: Record<ContentKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  document: "Document",
  archive: "Archive",
  code: "Text",
  text: "Text",
  database: "Database",
  book: "Book",
  font: "Text",
  mesh: "Mesh",
  config: "Document",
  encrypted: "Encrypted",
  key: "Key",
  executable: "Executable",
  binary: "Executable",
  spreadsheet: "Document",
  presentation: "Document",
  email: "Document",
  calendar: "Document",
  contact: "Document",
  web: "Globe",
  shortcut: "Link",
  package: "Package",
  model_entry: "Mesh",
  memory: "Database",
  unknown: "Document",
};

const fileCount = new Intl.NumberFormat();

function isContentKind(value: string | undefined): value is ContentKind {
  return (
    value !== undefined &&
    Object.prototype.hasOwnProperty.call(CONTENT_KIND_ICONS, value)
  );
}

function kindLabel(kind: ContentKind): string {
  return kind.replaceAll("_", " ");
}

function kindFilter(kind: ContentKind): SearchFilters {
  return {
    file_types: null,
    tags: null,
    date_range: null,
    size_range: null,
    locations: null,
    content_types: [kind],
    include_hidden: null,
    include_archived: null,
    at_risk: null,
    on_volumes: null,
    on_all_volumes: null,
    not_on_volumes: null,
    min_volume_count: null,
    max_volume_count: null,
  };
}

/** Live content kind counts from the library, using the archived Drive feature. */
export function FileKindsView() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useNormalizedQuery<
    ContentKindStatsInput,
    ContentKindStatsOutput
  >({
    query: "files.content_kind_stats",
    input: {},
    resourceType: "content_kind",
  });
  const stats = [...(data?.stats ?? [])]
    .filter((stat) => stat.file_count > 0)
    .toSorted((a, b) => b.file_count - a.file_count);

  return (
    <section
      aria-labelledby="file-kinds-title"
      className="flex h-full min-h-0 flex-col bg-surface text-on-surface"
    >
      <header className="border-b border-outline-variant px-6 py-5">
        <div className="flex items-end justify-between gap-4">
          <h1 id="file-kinds-title" className="text-headline-small">
            Types de fichiers
          </h1>
          {data && (
            <p className="text-right text-label-large text-on-surface-variant">
              <strong className="block text-headline-small font-normal text-on-surface">
                {fileCount.format(data.total_files)}
              </strong>
              contenus
            </p>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isLoading && (
          <output className="block p-4 text-label-large text-on-surface-variant">
            Chargement…
          </output>
        )}
        {error && (
          <div className="flex items-center gap-3 rounded-medium bg-error-container p-4 text-on-error-container">
            <p role="alert" className="text-label-large">
              Chargement impossible.
            </p>
            <Button
              aria-label="Réessayer"
              title="Réessayer"
              variant="text"
              size="lg"
              className="text-on-error-container"
              onClick={() => void refetch()}
            >
              <Icon name="refresh" size={18} />
            </Button>
          </div>
        )}
        {!isLoading && !error && stats.length === 0 && (
          <div className="flex items-center gap-3 p-4 text-label-large text-on-surface-variant">
            <span>Aucun contenu indexé.</span>
            <Link
              to="/sources"
              className={clsx(
                "rounded-medium px-3 py-2 text-primary",
                m3StateLayer,
                m3FocusRing,
              )}
            >
              Ajouter une source
            </Link>
          </div>
        )}
        {!error && stats.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2">
            {stats.map((stat) => {
              const content = (
                <>
                  <img
                    src={getIcon(CONTENT_KIND_ICONS[stat.kind], true)}
                    alt=""
                    className="mb-3 size-16"
                  />
                  <span className="text-label-large capitalize">
                    {kindLabel(stat.kind)}
                  </span>
                  <span className="mt-1 text-label-large text-on-surface-variant">
                    {fileCount.format(stat.file_count)}{" "}
                    {stat.file_count === 1 ? "contenu" : "contenus"}
                  </span>
                </>
              );
              const card =
                "flex min-h-40 flex-col items-center justify-center rounded-medium bg-surface-container-low p-4 text-center text-on-surface";
              return (
                <button
                  key={stat.kind}
                  type="button"
                  onClick={() => navigate(`/file-kinds/${stat.kind}`)}
                  className={clsx(card, m3StateLayer, m3FocusRing)}
                >
                  {content}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/** A stable URL for each type, backed by the existing searchable Explorer. */
export function FileKindResultsView() {
  const { kind } = useParams<{ kind: string }>();
  if (!isContentKind(kind)) return <Navigate to="/file-kinds" replace />;
  return <ContentKindExplorer kind={kind} />;
}

function ContentKindExplorer({ kind }: { kind: ContentKind }) {
  const { enterFilteredMode, exitFilteredMode, mode } = useExplorer();
  useEffect(() => {
    enterFilteredMode(kindFilter(kind), `Type de fichier : ${kindLabel(kind)}`);
    return () => exitFilteredMode();
  }, [kind, enterFilteredMode, exitFilteredMode]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 px-4 pt-3 text-title-medium text-on-surface">
        <Link
          to="/file-kinds"
          className={clsx(
            "inline-flex size-10 items-center justify-center rounded-full",
            m3StateLayer,
            m3FocusRing,
          )}
          aria-label="Retour aux types de fichiers"
        >
          <Icon name="arrow_back" size={20} />
        </Link>
        <h1 className="capitalize">{kindLabel(kind)}</h1>
      </div>
      <div className="min-h-0 flex-1">
        {mode.type === "filtered" &&
        mode.filters.content_types?.[0] === kind ? (
          <ExplorerView />
        ) : (
          <output className="block p-4 text-label-large text-on-surface-variant">
            Chargement…
          </output>
        )}
      </div>
    </div>
  );
}
