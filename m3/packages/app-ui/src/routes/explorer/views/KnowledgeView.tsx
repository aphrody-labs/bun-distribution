import { Icon, renderIcon, m3FocusRing, m3StateLayer } from "@aphrody/m3-primitives";
import type { IconSource } from "@aphrody/m3-primitives";
import { KnowledgeInspector } from "../../../components/Inspector/variants/KnowledgeInspector";
import { useExplorer } from "../context";
import { useNormalizedQuery } from "../../../contexts/SpacedriveContext";
import type { File, ContentKind } from "@aphrody/drive-client";
import { getContentKind } from "@aphrody/drive-client";
import { useMemo } from "react";
import { clsx } from "clsx";
import { File as FileComponent } from "../File";

const CONTENT_KIND_ICONS: Record<ContentKind, string> = {
  image: "image",
  video: "movie",
  audio: "music_note",
  document: "description",
  archive: "folder",
  code: "description",
  text: "description",
  database: "database",
  book: "description",
  font: "description",
  mesh: "draft",
  config: "description",
  encrypted: "draft",
  key: "draft",
  executable: "draft",
  binary: "draft",
  spreadsheet: "description",
  presentation: "description",
  email: "description",
  calendar: "description",
  contact: "description",
  web: "description",
  shortcut: "draft",
  package: "folder",
  model_entry: "draft",
  memory: "draft",
  unknown: "draft",
};

const CONTENT_KIND_LABELS: Record<ContentKind, string> = {
  image: "Images",
  video: "Videos",
  audio: "Audio",
  document: "Documents",
  archive: "Archives",
  code: "Code",
  text: "Text",
  database: "Databases",
  book: "Books",
  font: "Fonts",
  mesh: "3D Models",
  config: "Config",
  encrypted: "Encrypted",
  key: "Keys",
  executable: "Apps",
  binary: "Binary",
  spreadsheet: "Spreadsheets",
  presentation: "Presentations",
  email: "Emails",
  calendar: "Calendar",
  contact: "Contacts",
  web: "Web",
  shortcut: "Shortcuts",
  package: "Packages",
  model_entry: "Models",
  memory: "Memory",
  unknown: "Other",
};

export function KnowledgeView() {
  const { inspectorVisible, currentPath, sortBy, viewSettings } = useExplorer();

  const directoryQuery = useNormalizedQuery({
    query: "files.directory_listing",
    input: currentPath
      ? {
          path: currentPath,
          limit: null,
          include_hidden: false,
          sort_by: sortBy,
          folders_first: viewSettings.foldersFirst,
        }
      : null,
    resourceType: "file",
    enabled: !!currentPath,
  });

  const files = useMemo(
    () => (directoryQuery.data?.files || []) as File[],
    [directoryQuery.data?.files],
  );

  // Group files by content kind
  const filesByKind = useMemo(() => {
    const groups = new Map<ContentKind, File[]>();

    files.forEach((file) => {
      const kind = getContentKind(file) || "unknown";
      if (!groups.has(kind)) {
        groups.set(kind, []);
      }
      groups.get(kind)!.push(file);
    });

    // Sort by count and return top categories
    return Array.from(groups.entries())
      .toSorted((a, b) => b[1].length - a[1].length)
      .slice(0, 6);
  }, [files]);

  // Collect all unique tags
  const allTags = useMemo(() => {
    const tagMap = new Map<string, { id: string; name: string; color: string; count: number }>();

    files.forEach((file) => {
      file.tags?.forEach((tag) => {
        if (tagMap.has(tag.id)) {
          tagMap.get(tag.id)!.count++;
        } else {
          tagMap.set(tag.id, {
            id: tag.id,
            name: tag.canonical_name,
            color: tag.color || "#3B82F6",
            count: 1,
          });
        }
      });
    });

    return Array.from(tagMap.values()).toSorted((a, b) => b.count - a.count);
  }, [files]);

  return (
    <div className="flex h-full gap-2">
      {/* Main content area */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-4">
        <div className="max-w-5xl space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Icon name="auto_awesome" size={32} filled className="text-primary" />
            <div>
              <h1 className="text-headline-small text-on-surface">Knowledge view</h1>
              <p className="text-body-medium text-on-surface-variant">
                AI-powered insights for {files.length} items
              </p>
            </div>
          </div>

          {/* Content Piles */}
          <Section title="Content" icon="folder">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {filesByKind.map(([kind, kindFiles]) => (
                <ContentPile
                  key={kind}
                  kind={kind}
                  files={kindFiles.slice(0, 3)}
                  totalCount={kindFiles.length}
                />
              ))}
            </div>
          </Section>

          {/* Tags */}
          {allTags.length > 0 && (
            <Section title="Tags" icon="sell">
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => (
                  <button
                    key={tag.id}
                    className={clsx(
                      "flex h-8 items-center gap-2 px-3 rounded-small border border-outline-variant text-on-surface-variant",
                      m3StateLayer,
                      m3FocusRing,
                    )}
                  >
                    <div
                      className="size-2 rounded-full"
                      style={{
                        backgroundColor: tag.color,
                      }}
                    />
                    <span className="text-label-large text-on-surface-variant">{tag.name}</span>
                    <span className="text-body-small text-on-surface-variant">({tag.count})</span>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* Summary & Conversations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Summary */}
            <Section title="Summary" icon="auto_awesome">
              <div className="space-y-2 text-body-medium text-on-surface-variant">
                <p>
                  This directory contains {files.length} items across {filesByKind.length} content
                  types.
                </p>
                {filesByKind.length > 0 && (
                  <p>
                    Most common type: {CONTENT_KIND_LABELS[filesByKind[0][0]]} (
                    {filesByKind[0][1].length} items)
                  </p>
                )}
                {allTags.length > 0 && (
                  <p>Tagged items: {allTags.reduce((sum, tag) => sum + tag.count, 0)}</p>
                )}
              </div>
            </Section>

            {/* Conversations */}
            <Section title="Conversations" icon="chat">
              <div className="grid grid-cols-2 gap-2">
                <ConversationCard
                  title="Organize photos"
                  preview="Can you help sort these by date?"
                  time="2h ago"
                />
                <ConversationCard
                  title="Find duplicates"
                  preview="Looking for duplicate files in..."
                  time="Yesterday"
                />
              </div>
            </Section>
          </div>

          {/* Intelligence Sidecars */}
          <Section title="Intelligence" icon="database">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <SidecarItem
                kind="OCR Text"
                variant="Extracted text from 12 images"
                status="ready"
                size="2.4 MB"
              />
              <SidecarItem
                kind="Thumbnails"
                variant="Generated for 48 media files"
                status="ready"
                size="8.1 MB"
              />
              <SidecarItem
                kind="Video Transcripts"
                variant="Speech-to-text from 3 videos"
                status="pending"
                size="—"
              />
              <SidecarItem
                kind="Embeddings"
                variant="Semantic vectors for search"
                status="ready"
                size="14.2 MB"
              />
            </div>
          </Section>
        </div>
      </div>

      {/* Dedicated Knowledge Inspector */}
      {inspectorVisible && (
        <div className="w-96 h-full shrink-0 pr-2 pb-2">
          <div className="h-full rounded-medium overflow-hidden bg-surface-container-low">
            <KnowledgeInspector />
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconSource;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {renderIcon(icon, { size: 16, weight: 600, className: "text-on-surface-variant" })}
        <h2 className="text-title-small text-on-surface">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function ContentPile({
  kind,
  files,
  totalCount,
}: {
  kind: ContentKind;
  files: File[];
  totalCount: number;
}) {
  const iconName = CONTENT_KIND_ICONS[kind];
  const label = CONTENT_KIND_LABELS[kind];

  return (
    <button
      className={clsx(
        "group flex flex-col items-center gap-2 p-3 rounded-medium text-on-surface",
        m3StateLayer,
        m3FocusRing,
      )}
    >
      {/* Stacked file previews */}
      <div className="relative w-full aspect-square">
        {files.length > 0 ? (
          files.map((file, i) => (
            <div
              key={file.id}
              className="absolute inset-0"
              style={{
                transform: `rotate(${(i - 1) * 3}deg) translateY(${i * 2}px)`,
                zIndex: files.length - i,
              }}
            >
              <FileComponent.Thumb
                file={file}
                size={120}
                iconScale={0.5}
                className="w-full h-full rounded-small shadow-md3-1"
              />
            </div>
          ))
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            <Icon name={iconName} size={48} weight={200} className="text-outline" />
          </div>
        )}
      </div>

      {/* Label */}
      <div className="text-center">
        <div className="text-label-medium text-on-surface">{label}</div>
        <div className="text-label-small text-on-surface-variant">{totalCount} items</div>
      </div>
    </button>
  );
}

function ConversationCard({
  title,
  preview,
  time,
}: {
  title: string;
  preview: string;
  time: string;
}) {
  return (
    <button
      className={clsx(
        "flex flex-col gap-1.5 p-3 rounded-medium bg-surface-container-low border border-outline-variant text-left text-on-surface",
        m3StateLayer,
        m3FocusRing,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-title-small text-on-surface truncate">{title}</div>
        <Icon name="auto_awesome" size={12} filled className="text-primary" />
      </div>
      <p className="text-body-small text-on-surface-variant line-clamp-2">{preview}</p>
      <span className="text-label-small text-outline">{time}</span>
    </button>
  );
}

function SidecarItem({
  kind,
  variant,
  status,
  size,
}: {
  kind: string;
  variant: string;
  status: "ready" | "pending";
  size: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-medium bg-surface-container-low border border-outline-variant">
      <div className="size-10 shrink-0 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center">
        <Icon name="database" size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-title-small text-on-surface">{kind}</div>
        <div className="text-body-small text-on-surface-variant">{variant}</div>
        <div className="text-label-small text-outline mt-1">{size}</div>
      </div>
      <span
        className={clsx(
          "text-label-small px-2 py-0.5 rounded-small shrink-0",
          status === "ready" && "bg-secondary-container text-on-secondary-container",
          status === "pending" && "bg-surface-container-highest text-on-surface-variant",
        )}
      >
        {status}
      </span>
    </div>
  );
}
