// SPDX-License-Identifier: Apache-2.0
import { useDndContext, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowsClockwise,
  ArrowsOut,
  CircleNotch,
  FunnelSimple,
  GearSix,
  ListBullets,
} from "@phosphor-icons/react";
import { useSidebarStore } from "@aphrody/drive-client";
import type {
  Space,
  SpaceGroup as SpaceGroupType,
  SpaceItem as SpaceItemType,
} from "@aphrody/drive-client";
import { CircleButton, Popover, usePopover, type IconComponentProps } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { motion } from "motion/react";
import { memo, useEffect, useState, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { usePlatform } from "../../contexts/PlatformContext";
import { useSpacedriveClient } from "../../contexts/SpacedriveContext";
import { useLibraries } from "../../hooks/useLibraries";
import { JobList } from "../JobManager/components/JobList";
import { useJobsContext } from "../JobManager/hooks/JobsContext";
import { CARD_HEIGHT } from "../JobManager/types";
import { ActivityFeed } from "../SyncMonitor/components/ActivityFeed";
import { PeerList } from "../SyncMonitor/components/PeerList";
import { useSyncCount } from "../SyncMonitor/hooks/useSyncCount";
import { useSyncMonitor } from "../SyncMonitor/hooks/useSyncMonitor";
import { AddGroupButton } from "./AddGroupButton";
import { useSpaceLayout, useSpaces } from "./hooks/useSpaces";
import { SpaceGroup } from "./SpaceGroup";
import { SpaceItem } from "./SpaceItem";
import { SpaceSwitcher } from "./SpaceSwitcher";
import { useChatStore, getProjectGroups } from "../../stores/chat-store";
import { useI18n } from "../../i18n";
import { browserOnlyRoutes, desktopRoutes } from "../../desktop-navigation";
import { publicDestinations } from "../../public-navigation";
import { useKitVisible } from "../../routes/kit/use-kit-visible";

// Wrapper that adds a space-level drop zone before each group and makes it sortable
function SpaceGroupWithDropZone({
  group,
  items,
  spaceId,
  isFirst: _isFirst,
}: {
  group: SpaceGroupType;
  items: SpaceItemType[];
  spaceId?: string;
  isFirst: boolean;
}) {
  const { active } = useDndContext();
  const isDraggingSortableItem = active?.data?.current?.label != null;

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `space-root-before-${group.id}`,
    disabled: !spaceId || isDraggingSortableItem,
    data: {
      action: "add-to-space",
      spaceId,
      groupId: null,
    },
  });

  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: group.id,
    data: {
      label: group.name,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setSortableRef}
      style={style}
      className={clsx("relative", isDragging && "z-50 opacity-50")}
    >
      <div ref={setDropRef} className="absolute -top-2.5 left-0 right-0 z-10 h-5">
        {isOver && !isDragging && !isDraggingSortableItem && (
          <div className="bg-primary absolute left-2 right-2 top-1/2 h-[2px] -translate-y-1/2 rounded-full" />
        )}
      </div>
      <SpaceGroup
        group={group}
        items={items}
        spaceId={spaceId}
        sortableAttributes={attributes}
        sortableListeners={listeners}
      />
    </div>
  );
}

const getStateColor = (state: string) => {
  switch (state) {
    case "Ready":
      return "bg-success";
    case "Backfilling":
      return "bg-warning";
    case "CatchingUp":
      return "bg-primary";
    case "Uninitialized":
      return "bg-outline";
    case "Paused":
      return "bg-on-surface-variant";
    default:
      return "bg-outline";
  }
};

function SyncIcon({ className, size }: IconComponentProps) {
  return <ArrowsClockwise className={className} size={size} />;
}

function SpinningSyncIcon({ className, size }: IconComponentProps) {
  return <CircleNotch className={clsx(className, "animate-spin")} size={size} />;
}

function JobsIcon({ className, size }: IconComponentProps) {
  return <ListBullets className={className} size={size} />;
}

function RunningJobsIcon({ className, size }: IconComponentProps) {
  return <CircleNotch className={clsx(className, "animate-spin text-primary")} size={size} />;
}

// Sync Monitor Button with Popover
const SyncButton = memo(function SyncButton() {
  const popover = usePopover();
  const navigate = useNavigate();
  const [showActivityFeed, setShowActivityFeed] = useState(false);
  const [prevPopoverOpen, setPrevPopoverOpen] = useState(popover.open);
  const { onlinePeerCount, isSyncing } = useSyncCount();
  const sync = useSyncMonitor();

  if (popover.open !== prevPopoverOpen) {
    setPrevPopoverOpen(popover.open);
    if (popover.open) setShowActivityFeed(false);
  }

  return (
    <Popover.Root open={popover.open} onOpenChange={popover.setOpen}>
      <Popover.Trigger asChild>
        <CircleButton icon={isSyncing ? SpinningSyncIcon : SyncIcon} title="Synchro" />
      </Popover.Trigger>
      <Popover.Content
        side="top"
        align="start"
        sideOffset={8}
        className="!bg-surface z-50 max-h-[520px] w-[380px] !rounded-medium !p-0"
      >
        <div className="border-outline-variant flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-on-surface text-label-large font-semibold">Synchro</h3>

          <div className="flex items-center gap-2">
            {onlinePeerCount > 0 && (
              <span className="text-on-surface-variant text-body-large">
                {onlinePeerCount} {onlinePeerCount === 1 ? "pair connecté" : "pairs connectés"}
              </span>
            )}

            <CircleButton
              icon={ArrowsOut}
              onClick={() => navigate("/sync")}
              title="Ouvrir le moniteur de synchro"
            />

            <CircleButton
              icon={FunnelSimple}
              active={showActivityFeed}
              onClick={() => setShowActivityFeed(!showActivityFeed)}
              title={showActivityFeed ? "Afficher les pairs" : "Afficher l'activité"}
            />
          </div>
        </div>

        {popover.open && (
          <>
            <div className="border-outline-variant bg-surface-container/50 border-b px-4 py-2">
              <div className="flex items-center gap-2">
                <div className={`size-2 rounded-full ${getStateColor(sync.currentState)}`} />
                <span className="text-on-surface-variant text-label-large font-medium">
                  {sync.currentState}
                </span>
              </div>
            </div>
            <motion.div
              className="no-scrollbar overflow-y-auto"
              initial={false}
              animate={{
                height: showActivityFeed
                  ? Math.min(sync.recentActivity.length * 40 + 16, 400)
                  : Math.min(sync.peers.length * 80 + 16, 400),
              }}
              transition={{
                duration: 0.2,
                ease: [0.25, 1, 0.5, 1],
              }}
            >
              {showActivityFeed ? (
                <ActivityFeed activities={sync.recentActivity} />
              ) : (
                <PeerList peers={sync.peers} currentState={sync.currentState} />
              )}
            </motion.div>
          </>
        )}
      </Popover.Content>
    </Popover.Root>
  );
});

// Jobs Button with Popover
const JobsButton = memo(
  function JobsButton({
    activeJobCount,
    hasRunningJobs,
    jobs,
    pause,
    resume,
    cancel,
    getSpeedHistory,
    onOpenTasks,
  }: {
    activeJobCount: number;
    hasRunningJobs: boolean;
    jobs: any[];
    pause: (jobId: string) => Promise<void>;
    resume: (jobId: string) => Promise<void>;
    cancel: (jobId: string) => Promise<void>;
    getSpeedHistory: (jobId: string) => any[];
    onOpenTasks?: () => void;
  }) {
    const popover = usePopover();
    const [showOnlyRunning, setShowOnlyRunning] = useState(true);
    const [prevPopoverOpen, setPrevPopoverOpen] = useState(popover.open);

    if (popover.open !== prevPopoverOpen) {
      setPrevPopoverOpen(popover.open);
      if (popover.open) setShowOnlyRunning(true);
    }

    const filteredJobs = showOnlyRunning
      ? jobs.filter(
          (job) => job.status === "running" || job.status === "paused" || job.status === "queued",
        )
      : jobs;

    return (
      <Popover.Root open={popover.open} onOpenChange={popover.setOpen}>
        <Popover.Trigger asChild>
          <CircleButton icon={hasRunningJobs ? RunningJobsIcon : JobsIcon} title="Tâches" />
        </Popover.Trigger>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="!bg-surface z-50 max-h-[480px] w-[360px] !rounded-medium !p-0"
        >
          <div className="border-outline-variant flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-on-surface text-label-large font-semibold">Tâches</h3>

            <div className="flex items-center gap-2">
              {activeJobCount > 0 && (
                <span className="text-on-surface-variant text-body-large">
                  {activeJobCount} en cours
                </span>
              )}

              <CircleButton
                icon={FunnelSimple}
                active={showOnlyRunning}
                onClick={() => setShowOnlyRunning(!showOnlyRunning)}
                title={showOnlyRunning ? "Toutes les tâches" : "Tâches actives uniquement"}
              />

              {onOpenTasks && (
                <CircleButton
                  icon={ArrowsOut}
                  onClick={() => {
                    popover.setOpen(false);
                    onOpenTasks();
                  }}
                  title="Ouvrir le tableau de bord complet des tâches"
                />
              )}
            </div>
          </div>

          {popover.open && (
            <motion.div
              className="no-scrollbar overflow-y-auto"
              initial={false}
              animate={{
                height:
                  filteredJobs.length === 0
                    ? CARD_HEIGHT + 16
                    : Math.min(filteredJobs.length * (CARD_HEIGHT + 8) + 16, 400),
              }}
              transition={{
                duration: 0.2,
                ease: [0.25, 1, 0.5, 1],
              }}
            >
              <JobList
                jobs={filteredJobs}
                onPause={pause}
                onResume={resume}
                onCancel={cancel}
                getSpeedHistory={getSpeedHistory}
              />
            </motion.div>
          )}
        </Popover.Content>
      </Popover.Root>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.activeJobCount === nextProps.activeJobCount &&
      prevProps.hasRunningJobs === nextProps.hasRunningJobs
    );
  },
);

interface SpacesSidebarProps {
  isPreviewActive?: boolean;
}

// Application settings and native product settings share this navigation shell.
const SETTINGS_SECTIONS = [
  { id: "general", label: "Général", icon: "settings" },
  { id: "appearance", label: "Apparence", icon: "palette" },
  { id: "agent", label: "Agent", icon: "smart_toy" },
  { id: "models", label: "Modèles", icon: "model_training" },
  { id: "web", label: "Web", icon: "language" },
  { id: "keyboard", label: "Clavier", icon: "keyboard" },
];

export function SpacesSidebar({ isPreviewActive = false }: SpacesSidebarProps) {
  const client = useSpacedriveClient();
  const platform = usePlatform();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { data: libraries } = useLibraries();
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(() =>
    client.getCurrentLibraryId(),
  );

  // Settings section search filter
  const [settingsSearch, setSettingsSearch] = useState("");

  // Chat Store connection
  const {
    threads,
    activeThreadId,
    unreadThreadIds,
    expandedProjects,
    setActiveThreadId,
    toggleProjectExpanded,
    requestNewSession,
  } = useChatStore();

  const projectGroups = useMemo(
    () => getProjectGroups(threads, expandedProjects),
    [threads, expandedProjects],
  );

  const recentThreads = useMemo(() => {
    return [...threads]
      .toSorted((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      .slice(0, 8);
  }, [threads]);

  // Job and sync status
  useSyncCount();
  const { activeJobCount, hasRunningJobs, jobs, pause, resume, cancel, getSpeedHistory } =
    useJobsContext();

  const { currentSpaceId, setCurrentSpace } = useSidebarStore();
  const { data: spacesData } = useSpaces();
  const spaces = (spacesData as any)?.spaces as Space[] | undefined;

  useEffect(() => {
    const handleLibraryChange = (newLibraryId: string) => {
      setCurrentLibraryId(newLibraryId);
    };

    client.on("library-changed", handleLibraryChange);
    return () => {
      client.off("library-changed", handleLibraryChange);
    };
  }, [client]);

  useEffect(() => {
    if (libraries && libraries.length > 0 && !currentLibraryId) {
      const firstLib = libraries[0];
      if (platform.setCurrentLibraryId) {
        platform
          .setCurrentLibraryId(firstLib.id)
          .catch((err) => console.error("Failed to set library ID:", err));
      } else {
        client.setCurrentLibrary(firstLib.id);
      }
    }
  }, [libraries, currentLibraryId, client, platform]);

  const currentSpace = spaces?.find((s) => s.id === currentSpaceId) ?? spaces?.[0];

  useEffect(() => {
    if (currentSpace && currentSpace.id !== currentSpaceId) {
      setCurrentSpace(currentSpace.id);
    }
  }, [currentSpace, currentSpaceId, setCurrentSpace]);

  const { data: layoutData } = useSpaceLayout(currentSpace?.id ?? null);
  const layout = layoutData as
    | {
        space_items: SpaceItemType[];
        groups: Array<{ group: SpaceGroupType; items: SpaceItemType[] }>;
      }
    | undefined;
  const layoutGroups = layout?.groups;

  const { language, setLanguage } = useI18n();

  // Active Area Detection
  const isChatActive =
    location.pathname === "/chat" ||
    location.pathname === "/codex" ||
    location.pathname.startsWith("/chat/");
  const isFilesActive =
    location.pathname.startsWith("/explorer") ||
    location.pathname.startsWith("/file-kinds") ||
    location.pathname.startsWith("/redundancy") ||
    location.pathname.startsWith("/tag") ||
    location.pathname.startsWith("/sources") ||
    location.pathname.startsWith("/recents") ||
    location.pathname.startsWith("/location");
  const isModelsActive = location.pathname.startsWith("/models");
  const isStudioActive = location.pathname.startsWith("/studio");
  const isTerminalActive = location.pathname.startsWith(browserOnlyRoutes.terminal);
  const isCreatorActive = location.pathname.startsWith(desktopRoutes.creator);
  const isAdminActive = location.pathname.startsWith(desktopRoutes.admin);
  const showCreator = useKitVisible("creator") || isCreatorActive;
  const showAdmin = useKitVisible("omar", true) || isAdminActive;
  const isSettingsActive = location.pathname.startsWith("/settings");

  // Active setting section
  const currentSettingsSection = searchParams.get("section") || "general";

  // Filtered files groups: strictly remove Overview, Redundancy, and isolated Favorites
  const filteredGroups = useMemo(() => {
    if (!layoutGroups) return [];
    return layoutGroups.filter(({ group }) => {
      const lower = (group.name || "").toLowerCase();
      return (
        lower !== "overview" &&
        lower !== "redundancy" &&
        lower !== "favorites" &&
        lower !== "favoris"
      );
    });
  }, [layoutGroups]);

  // Filtered settings sections
  const filteredSettingsSections = useMemo(() => {
    if (!settingsSearch.trim()) return SETTINGS_SECTIONS;
    const q = settingsSearch.toLowerCase();
    return SETTINGS_SECTIONS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    );
  }, [settingsSearch]);

  return (
    <div className="flex h-full w-[280px] min-w-[240px] max-w-[360px] flex-col bg-transparent p-2">
      <div
        className={clsx(
          "flex h-full flex-col overflow-hidden rounded-large",
          isPreviewActive
            ? "bg-surface-container-low/80 backdrop-blur-2xl"
            : "bg-surface-container-low/65",
        )}
      >
        <nav
          className={clsx(
            "relative z-[51] flex h-full flex-col gap-2 p-3 pb-2",
            platform.platform === "tauri" && "pt-[43px]",
          )}
        >
          {/* Switcher en haut avec avatar Aphrody */}
          <SpaceSwitcher spaces={spaces} currentSpace={currentSpace} onSwitch={setCurrentSpace} />

          {/* Les 4 zones principales (icônes M3, 48dp, label-large 18px) */}
          <div className="flex flex-col gap-1 border-b border-outline-variant/30 pb-2">
            {publicDestinations.map(({ route, label, icon }) => {
              const selected =
                route === "/"
                  ? location.pathname === "/"
                  : location.pathname === route ||
                    location.pathname.startsWith(`${route}/`) ||
                    (route === "/material-3" && location.pathname.startsWith("/showcase"));
              return (
                <button
                  key={route}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => navigate(route)}
                  className={clsx(
                    "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                    selected
                      ? "bg-secondary-container text-on-secondary-container"
                      : "text-on-surface-variant hover:bg-secondary-container/20",
                  )}
                >
                  <span className="material-symbol text-title-medium" aria-hidden="true">
                    {icon}
                  </span>
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => navigate(desktopRoutes.chat)}
              className={clsx(
                "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                isChatActive && !isSettingsActive
                  ? "bg-secondary-container text-on-secondary-container font-semibold"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
              )}
            >
              <span
                className={clsx(
                  "material-symbol text-title-medium",
                  isChatActive && !isSettingsActive && "font-bold",
                )}
              >
                chat
              </span>
              <span className="truncate">{language === "fr" ? "Chat" : "Chat"}</span>
            </button>

            <button
              type="button"
              onClick={() => navigate(desktopRoutes.files)}
              className={clsx(
                "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                isFilesActive && !isSettingsActive
                  ? "bg-secondary-container text-on-secondary-container font-semibold"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
              )}
            >
              <span
                className={clsx(
                  "material-symbol text-title-medium",
                  isFilesActive && !isSettingsActive && "font-bold",
                )}
              >
                folder_open
              </span>
              <span className="truncate">{language === "fr" ? "Fichiers" : "Files"}</span>
            </button>

            {platform.platform !== "tauri" && (
              <button
                type="button"
                onClick={() => navigate(browserOnlyRoutes.terminal)}
                className={clsx(
                  "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                  isTerminalActive && !isSettingsActive
                    ? "bg-secondary-container text-on-secondary-container font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                )}
              >
                <span
                  className={clsx(
                    "material-symbol text-title-medium",
                    isTerminalActive && !isSettingsActive && "font-bold",
                  )}
                >
                  terminal
                </span>
                <span className="truncate">Terminal</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate(desktopRoutes.models)}
              className={clsx(
                "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                isModelsActive && !isSettingsActive
                  ? "bg-secondary-container text-on-secondary-container font-semibold"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
              )}
            >
              <span
                className={clsx(
                  "material-symbol text-title-medium",
                  isModelsActive && !isSettingsActive && "font-bold",
                )}
              >
                model_training
              </span>
              <span className="truncate">{language === "fr" ? "Modèles" : "Models"}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(desktopRoutes.studio)}
              className={clsx(
                "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                isStudioActive && !isSettingsActive
                  ? "bg-secondary-container text-on-secondary-container font-semibold"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
              )}
            >
              <span
                className={clsx(
                  "material-symbol text-title-medium",
                  isStudioActive && !isSettingsActive && "font-bold",
                )}
              >
                auto_stories
              </span>
              <span className="truncate">Studio</span>
            </button>
            {showCreator && (
              <button
                type="button"
                onClick={() => navigate(desktopRoutes.creator)}
                className={clsx(
                  "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                  isCreatorActive
                    ? "bg-secondary-container text-on-secondary-container font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                )}
              >
                <span
                  className={clsx(
                    "material-symbol text-title-medium",
                    isCreatorActive && "font-bold",
                  )}
                >
                  brush
                </span>
                <span className="truncate">{language === "fr" ? "Créateur" : "Creator"}</span>
              </button>
            )}
            {showAdmin && (
              <button
                type="button"
                onClick={() => navigate(desktopRoutes.admin)}
                className={clsx(
                  "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                  isAdminActive
                    ? "bg-secondary-container text-on-secondary-container font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                )}
              >
                <span
                  className={clsx(
                    "material-symbol text-title-medium",
                    isAdminActive && "font-bold",
                  )}
                >
                  admin_panel_settings
                </span>
                <span className="truncate">
                  {language === "fr" ? "Administration" : "Administration"}
                </span>
              </button>
            )}
          </div>

          {/* Corps dynamique de la barre latérale selon la zone active */}
          <div className="no-scrollbar mask-fade-out mt-1 flex grow flex-col space-y-4 overflow-x-hidden overflow-y-auto pb-4">
            {/* --- CAS 1 : PARAMÈTRES ACTIFS (UI-DESIGN.md §4.6) --- */}
            {isSettingsActive && (
              <div className="space-y-3">
                {/* Champ de recherche dans les paramètres */}
                <div className="px-0.5">
                  <div className="flex h-12 items-center gap-2.5 rounded-full bg-surface-container-high px-3 border border-outline-variant/30 text-on-surface">
                    <span className="material-symbol text-title-small text-on-surface-variant">
                      search
                    </span>
                    <input
                      type="text"
                      value={settingsSearch}
                      onChange={(e) => setSettingsSearch(e.target.value)}
                      placeholder="Rechercher..."
                      className="w-full bg-transparent text-label-large text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none"
                    />
                    {settingsSearch && (
                      <button
                        type="button"
                        onClick={() => setSettingsSearch("")}
                        className="text-on-surface-variant hover:text-on-surface"
                      >
                        <span className="material-symbol text-title-small">close</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Les 6 sections STRICTES */}
                <div className="space-y-1">
                  {filteredSettingsSections.map((section) => {
                    const isSelected = currentSettingsSection === section.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => navigate(`/settings?section=${section.id}`)}
                        className={clsx(
                          "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                          isSelected
                            ? "bg-secondary-container text-primary font-semibold"
                            : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                        )}
                      >
                        <span className="material-symbol text-title-small opacity-80">
                          {section.icon}
                        </span>
                        <span className="truncate">{section.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* --- CAS 2 : CHAT ACTIF (Nouveau chat, Projets, Récents) --- */}
            {isChatActive && !isSettingsActive && (
              <div className="space-y-4">
                {/* Bouton Nouveau chat avec icône compose */}
                <button
                  type="button"
                  onClick={() => {
                    requestNewSession();
                    navigate(desktopRoutes.chat);
                  }}
                  className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-secondary-container hover:bg-secondary-container/80 text-on-secondary-container px-4 text-label-large font-medium transition-colors cursor-pointer select-none"
                >
                  <span className="material-symbol text-title-small">edit_square</span>
                  <span>Nouveau chat</span>
                </button>

                {/* Section Projets avec arborescence et puce bleue non-lue */}
                <div className="space-y-1.5">
                  <div className="px-2 text-label-large font-medium text-on-surface-variant">
                    Projets
                  </div>
                  <div className="space-y-1">
                    {projectGroups.map((project) => {
                      return (
                        <div key={project.name} className="space-y-0.5">
                          {/* Dossier du projet */}
                          <button
                            type="button"
                            onClick={() => toggleProjectExpanded(project.name)}
                            className="flex h-10 w-full items-center justify-between rounded-full px-3 text-label-large font-medium text-on-surface hover:bg-secondary-container/20 cursor-pointer text-left select-none transition-colors"
                          >
                            <div className="flex items-center gap-2 overflow-hidden">
                              <span className="material-symbol text-title-small text-primary shrink-0">
                                folder
                              </span>
                              <span className="truncate font-semibold">{project.name}</span>
                            </div>
                            <span className="material-symbol text-title-small text-on-surface-variant">
                              {project.expanded ? "expand_more" : "chevron_right"}
                            </span>
                          </button>

                          {/* Fils imbriqués (indentation 24px) */}
                          {project.expanded && (
                            <div className="ml-6 space-y-0.5 border-l border-outline-variant/30 pl-2">
                              {project.threads.length === 0 ? (
                                <div className="px-3 py-1 text-body-large text-on-surface-variant/50 italic">
                                  Aucun chat : ouvrez-en un dans ce projet
                                </div>
                              ) : (
                                project.threads.map((thread) => {
                                  const isActive = thread.id === activeThreadId;
                                  const isUnread = !!unreadThreadIds[thread.id];
                                  return (
                                    <button
                                      key={thread.id}
                                      type="button"
                                      onClick={() => {
                                        setActiveThreadId(thread.id);
                                        navigate(desktopRoutes.chat);
                                      }}
                                      className={clsx(
                                        "flex h-10 w-full items-center justify-between rounded-full px-3 text-body-large font-medium transition-colors cursor-pointer text-left select-none",
                                        isActive
                                          ? "bg-secondary-container text-on-secondary-container font-semibold"
                                          : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                                      )}
                                    >
                                      <span className="truncate">
                                        {thread.name || thread.preview || "Sans titre"}
                                      </span>
                                      {isUnread && (
                                        <span className="size-2 rounded-full bg-primary shrink-0 ml-1.5" />
                                      )}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Section Récents */}
                <div className="space-y-1.5 pt-2 border-t border-outline-variant/20">
                  <div className="px-2 text-label-large font-medium text-on-surface-variant">
                    Récents
                  </div>
                  <div className="space-y-0.5">
                    {recentThreads.map((thread) => {
                      const isActive = thread.id === activeThreadId;
                      const isUnread = !!unreadThreadIds[thread.id];
                      return (
                        <button
                          key={thread.id}
                          type="button"
                          onClick={() => {
                            setActiveThreadId(thread.id);
                            navigate(desktopRoutes.chat);
                          }}
                          className={clsx(
                            "flex h-10 w-full items-center justify-between rounded-full px-3 text-body-large font-medium transition-colors cursor-pointer text-left select-none",
                            isActive
                              ? "bg-secondary-container text-on-secondary-container font-semibold"
                              : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                          )}
                        >
                          <span className="truncate">
                            {thread.name || thread.preview || "Sans titre"}
                          </span>
                          {isUnread && (
                            <span className="size-2 rounded-full bg-primary shrink-0 ml-1.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* --- CAS 3 : FICHIERS ACTIF (Groupes Spacedrive canoniques) --- */}
            {isFilesActive && !isSettingsActive && (
              <div className="space-y-4">
                {/* Shortcuts racines */}
                <button
                  type="button"
                  onClick={() => navigate("/redundancy")}
                  aria-current={location.pathname.startsWith("/redundancy") ? "page" : undefined}
                  className={clsx(
                    "flex min-h-10 w-full items-center gap-2 rounded-full px-3 text-left text-body-large outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    location.pathname.startsWith("/redundancy")
                      ? "bg-secondary-container text-on-secondary-container"
                      : "text-on-surface-variant hover:bg-secondary-container/20 hover:text-on-surface",
                  )}
                >
                  <span className="material-symbol text-title-medium" aria-hidden="true">
                    verified_user
                  </span>
                  <span>{language === "fr" ? "Redondance" : "Redundancy"}</span>
                </button>
                {layout?.space_items && layout.space_items.length > 0 && (
                  <SortableContext
                    items={layout.space_items.map((item) => item.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-0.5">
                      {layout.space_items.map((item, index) => (
                        <SpaceItem
                          key={item.id}
                          item={item}
                          isLastItem={index === layout.space_items.length - 1}
                          allowInsertion={true}
                          spaceId={currentSpace?.id}
                          groupId={null}
                          sortable={true}
                        />
                      ))}
                    </div>
                  </SortableContext>
                )}

                {/* Groupes canoniques (Devices, Locations, Tags, Volumes, Sources) */}
                {filteredGroups.length > 0 && (
                  <SortableContext
                    items={filteredGroups.map(({ group }) => group.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {filteredGroups.map(({ group, items }, index) => (
                      <SpaceGroupWithDropZone
                        key={group.id}
                        group={group}
                        items={items}
                        spaceId={currentSpace?.id}
                        isFirst={index === 0}
                      />
                    ))}
                  </SortableContext>
                )}

                {currentSpace && <AddGroupButton spaceId={currentSpace.id} />}
              </div>
            )}

            {/* --- CAS 5 : MODÈLES ACTIF (Installés, Catalogue) --- */}
            {isModelsActive && !isSettingsActive && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="px-2 text-label-large font-medium text-on-surface-variant">
                    Modèles locaux
                  </div>
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => navigate("/models?tab=installed")}
                      className="flex h-10 w-full items-center gap-2.5 rounded-full px-2 text-body-large font-medium text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20 cursor-pointer text-left select-none transition-colors"
                    >
                      <span className="material-symbol text-title-small text-success shrink-0">
                        check_circle
                      </span>
                      <span className="truncate">Installés</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate("/models?tab=catalog")}
                      className="flex h-10 w-full items-center gap-2.5 rounded-full px-2 text-body-large font-medium text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20 cursor-pointer text-left select-none transition-colors"
                    >
                      <span className="material-symbol text-title-small text-primary shrink-0">
                        explore
                      </span>
                      <span className="truncate">Catalogue</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Pied de sidebar : Tâches (Jobs), Synchro, Paramètres (Settings) */}
          <div className="flex items-center justify-between border-t border-outline-variant/30 pt-2.5">
            <div className="flex items-center gap-2">
              <JobsButton
                activeJobCount={activeJobCount}
                hasRunningJobs={hasRunningJobs}
                jobs={jobs}
                pause={pause}
                resume={resume}
                cancel={cancel}
                getSpeedHistory={getSpeedHistory}
                onOpenTasks={() => navigate("/jobs")}
              />
              <SyncButton />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLanguage(language === "fr" ? "en" : "fr")}
                className="flex h-9 items-center justify-center rounded-full px-2.5 text-[13px] font-semibold text-on-surface-variant hover:text-on-surface bg-surface-container-high hover:bg-surface-container-highest transition-colors cursor-pointer border border-outline-variant/40"
                title={language === "fr" ? "Switch to English" : "Passer en Français"}
              >
                {language.toUpperCase()}
              </button>

              <CircleButton
                icon={GearSix}
                title="Paramètres"
                active={isSettingsActive}
                onClick={() => navigate(desktopRoutes.settings)}
              />
            </div>
          </div>
        </nav>
      </div>
    </div>
  );
}
