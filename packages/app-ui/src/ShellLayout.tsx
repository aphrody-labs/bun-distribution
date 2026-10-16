import type { Location } from "@aphrody/drive-client";
import { clsx } from "clsx";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";
import { Inspector } from "./components/Inspector/Inspector";
import { JobsProvider } from "./components/JobManager/hooks/JobsContext";
import {
  PREVIEW_LAYER_ID,
  QuickPreviewController,
  QuickPreviewSyncer,
} from "./components/QuickPreview";
import { SpacesSidebar } from "./components/SpacesSidebar";
import { TabBar, TabDefaultsSync, TabNavigationSync } from "./components/TabManager";
import { usePlatform } from "./contexts/PlatformContext";
import { useNormalizedQuery } from "./contexts/SpacedriveContext";
import { WebContextMenuProvider } from "./contexts/WebContextMenuContext";
import { ExplorerProvider, useExplorer } from "./routes/explorer";
import { KeyboardHandler } from "./routes/explorer/KeyboardHandler";
import { SelectionProvider } from "./routes/explorer/SelectionContext";
import { TagAssignmentMode } from "./routes/explorer/TagAssignmentMode";
import { TopBar, TopBarProvider } from "./TopBar";
import { CommandPalette } from "./CommandPalette";
import { useMenuCommands } from "./menu-commands";
import { useOpenRequests } from "./use-open-requests";
import { NARROW_QUERY, Rail, RailDrawer, useMediaQuery } from "./rail-drawer";

/** M3 pane transitions: enter on emphasized-decelerate, exit on emphasized-accelerate. */
const paneEnter: Transition = {
  duration: m3Durations.medium4,
  ease: m3Easings.emphasizedDecelerate,
};
const paneExit: Transition = {
  duration: m3Durations.short4,
  ease: m3Easings.emphasizedAccelerate,
};

function ShellLayoutContent() {
  useMenuCommands();
  useOpenRequests();
  const location = useLocation();
  const params = useParams();
  const platform = usePlatform();
  const {
    sidebarVisible,
    inspectorVisible,
    setInspectorVisible,
    quickPreviewFileId,
    tagModeActive,
    setTagModeActive,
    viewMode,
    currentPath,
  } = useExplorer();

  // Suppress inspector on Chat, Web, Models and Settings; show only in Explorer/Files routes
  const isExplorer =
    location.pathname === "/os" ||
    location.pathname === "/os/" ||
    location.pathname.startsWith("/explorer") ||
    location.pathname.startsWith("/tag") ||
    location.pathname.startsWith("/sources") ||
    location.pathname.startsWith("/recents") ||
    location.pathname.startsWith("/file-kinds/") ||
    location.pathname.startsWith("/redundancy/");
  const isOverview = !isExplorer;
  const isKnowledgeView = viewMode === "knowledge";

  // Fetch locations to get current location info
  const locationsQuery = useNormalizedQuery<null, { locations: Location[] }>({
    query: "locations.list",
    input: null,
    resourceType: "location",
  });

  // Get current location if we're on a location route or browsing within a location
  const currentLocation = useMemo(() => {
    const locations = locationsQuery.data?.locations || [];

    // First try to match by route param (for /location/:id routes)
    if (params.locationId) {
      const matchedLocation = locations.find((entry) => entry.id === params.locationId);
      if (matchedLocation) return matchedLocation;
    }

    // If no route match, try to find location by matching current path
    if (currentPath && "Physical" in currentPath) {
      const pathStr = currentPath.Physical.path;
      // Find location with longest matching prefix
      return (
        locations
          .filter((loc) => {
            if (!loc.sd_path || !("Physical" in loc.sd_path)) return false;
            const locPath = loc.sd_path.Physical.path;
            return pathStr.startsWith(locPath);
          })
          .toSorted((a, b) => {
            const aPath = "Physical" in a.sd_path! ? a.sd_path!.Physical.path : "";
            const bPath = "Physical" in b.sd_path! ? b.sd_path!.Physical.path : "";
            return bPath.length - aPath.length;
          })[0] || null
      );
    }

    return null;
  }, [params.locationId, locationsQuery.data, currentPath]);

  useEffect(() => {
    // Listen for inspector window close events
    if (!platform.onWindowEvent) return;

    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        unlisten = await platform.onWindowEvent!("inspector-window-closed", () => {
          // Show embedded inspector when floating window closes
          setInspectorVisible(true);
        });
      } catch (err) {
        console.error("Failed to setup inspector close listener:", err);
      }
    })();

    return () => {
      unlisten?.();
    };
  }, [platform, setInspectorVisible]);

  const handlePopOutInspector = async () => {
    if (!platform.showWindow) return;

    try {
      await platform.showWindow({
        type: "Inspector",
        item_id: null,
      });
      // Hide the embedded inspector when popped out
      setInspectorVisible(false);
    } catch (err) {
      console.error("Failed to pop out inspector:", err);
    }
  };

  const narrow = useMediaQuery(NARROW_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Close the drawer when leaving the narrow layout (state adjusted during render, not in an effect).
  const [prevNarrow, setPrevNarrow] = useState(narrow);
  if (narrow !== prevNarrow) {
    setPrevNarrow(narrow);
    if (!narrow) setDrawerOpen(false);
  }
  const railWidth = !narrow && sidebarVisible ? 280 : 0;

  const isPreviewActive = !!quickPreviewFileId;
  const isSizeViewActive = viewMode === "size";

  return (
    <div
      className={clsx(
        // M3 scaffold: the window is the surface; the navigation drawer and the
        // inspector sheet sit on surface-container-low beside the content pane.
        "app-shell text-on-surface bg-surface font-plain text-body-medium relative flex h-full min-h-0 select-none flex-col overflow-hidden border border-transparent",
        platform.platform === "tauri" && "rounded-medium",
      )}
    >
      {/* Preview layer - portal target for fullscreen preview, sits between content and sidebar/inspector */}
      <div
        id={PREVIEW_LAYER_ID}
        className="pointer-events-none absolute inset-0 z-40 [&>*]:pointer-events-auto"
      />

      {/* Size view layer - portal target for fullscreen size view, sits below preview */}
      <div
        id="size-view-layer"
        className="pointer-events-none absolute inset-0 z-[35] [&>*]:pointer-events-auto"
      />

      {/* Top fade mask - spans full width beyond sidebar/inspector */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-[37] h-32 bg-gradient-to-b from-surface to-transparent" />

      {narrow && (
        <button
          type="button"
          className="app-rail-trigger text-on-surface hover:bg-on-surface/8 absolute left-1 top-0 z-[70] flex size-12 items-center justify-center rounded-full"
          aria-label="Ouvrir l'historique et les espaces"
          aria-controls="app-rail"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <span className="material-symbol" aria-hidden="true">
            menu
          </span>
        </button>
      )}
      <TopBar
        sidebarWidth={narrow ? 56 : railWidth}
        inspectorWidth={inspectorVisible && !isOverview && !isKnowledgeView ? 284 : 0}
        isPreviewActive={isPreviewActive || isSizeViewActive}
      />

      {/* Tab Bar floated above size view when active */}
      {isSizeViewActive && (
        <div
          className="pointer-events-none absolute left-0 right-0 z-[45] [&>*]:pointer-events-auto"
          style={{
            top: 48, // TopBar height
            paddingLeft: railWidth,
            paddingRight: inspectorVisible && !isOverview && !isKnowledgeView ? 280 : 0,
            transition:
              "padding var(--md-sys-motion-duration-medium2, 300ms) var(--md-sys-motion-easing-emphasized)",
          }}
        >
          <TabBar />
        </div>
      )}

      {/* Main content area with sidebar and content */}
      <div className="flex flex-1 overflow-hidden">
        {narrow ? (
          <RailDrawer open={drawerOpen} onOpenChange={setDrawerOpen} label="Historique et espaces">
            <SpacesSidebar isPreviewActive={false} />
          </RailDrawer>
        ) : (
          <Rail expanded={sidebarVisible} label="Historique et espaces">
            <SpacesSidebar isPreviewActive={isPreviewActive || isSizeViewActive} />
          </Rail>
        )}

        {/* Content area with tabs - positioned between sidebar and inspector */}
        <div
          className={clsx(
            "relative flex flex-1 flex-col overflow-hidden pt-12",
            isSizeViewActive ? "z-[30]" : "z-[38]",
          )}
          inert={(narrow && drawerOpen) || undefined}
        >
          {/* Tab Bar - nested inside content area like Finder (hidden in size view) */}
          {!isSizeViewActive && <TabBar />}

          {/* Router content renders here */}
          <div className="relative flex-1 overflow-hidden">
            <Outlet />

            {/* Tag Assignment Mode - positioned at bottom of main content area */}
            <TagAssignmentMode isActive={tagModeActive} onExit={() => setTagModeActive(false)} />
          </div>
        </div>

        {/* Keyboard handler (invisible, doesn't cause parent rerenders) */}
        <KeyboardHandler />

        {/* Syncs selection to QuickPreview - isolated to prevent frame rerenders */}
        <QuickPreviewSyncer />

        <AnimatePresence initial={false}>
          {/* Hide inspector on Overview screen and Knowledge view (has its own) */}
          {inspectorVisible && !isOverview && !isKnowledgeView && (
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: 280, transition: paneEnter }}
              exit={{ width: 0, transition: paneExit }}
              className="relative z-[65] overflow-hidden"
            >
              <div className="bg-surface-container-low flex h-full w-[280px] min-w-[280px] flex-col p-2">
                <Inspector
                  currentLocation={currentLocation}
                  onPopOut={platform.showWindow ? handlePopOutInspector : undefined}
                  isPreviewActive={isPreviewActive || isSizeViewActive}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Quick Preview - isolated component to prevent frame rerenders on selection change */}
      <QuickPreviewController
        sidebarWidth={railWidth}
        inspectorWidth={inspectorVisible && !isOverview && !isKnowledgeView ? 280 : 0}
      />

      {/* Command Palette (Ctrl+K / Cmd+K Spotlight unified launcher) */}
      <CommandPalette />
    </div>
  );
}

export function ShellLayout() {
  return (
    <JobsProvider>
      <TopBarProvider>
        <SelectionProvider>
          <ExplorerProvider>
            <WebContextMenuProvider>
              {/* Sync tab navigation and defaults with router */}
              <TabNavigationSync />
              <TabDefaultsSync />
              <ShellLayoutContent />
            </WebContextMenuProvider>
          </ExplorerProvider>
        </SelectionProvider>
      </TopBarProvider>
    </JobsProvider>
  );
}
