import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTabManager } from "./useTabManager";

import { browserDocumentTitle, deriveTitleFromPath } from "./route-title";

/**
 * TabNavigationSync - Syncs router navigation with active tab
 *
 * This component runs inside the router context and:
 * 1. Saves the current location to the active tab when navigation occurs
 * 2. Updates the tab title based on the current route
 * 3. Navigates to the saved location when switching to a different tab
 */
export function TabNavigationSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeTabId, tabs, updateTabPath, updateTabTitle } = useTabManager();

  const activeTab = tabs.find(t => t.id === activeTabId);
  const currentPath = location.pathname + location.search;

  // Track previous activeTabId to detect tab switches
  const prevActiveTabIdRef = useRef(activeTabId);

  // The opened URL owns startup. Restore saved locations only on an actual tab switch.
  useEffect(() => {
    if (prevActiveTabIdRef.current !== activeTabId) {
      prevActiveTabIdRef.current = activeTabId;
      if (activeTab && currentPath !== activeTab.savedPath) {
        void navigate(activeTab.savedPath, { replace: true });
      }
      return;
    }

    if (activeTab && currentPath !== activeTab.savedPath) {
      updateTabPath(activeTabId, currentPath);
    }

    // Update title based on current location (null = managed by the route component)
    const newTitle = deriveTitleFromPath(location.pathname, location.search);
    if (activeTab && newTitle !== null && newTitle !== activeTab.title) {
      updateTabTitle(activeTabId, newTitle);
    }
    if (typeof document !== "undefined") {
      document.title = browserDocumentTitle(
        location.pathname,
        newTitle ?? activeTab?.title ?? null,
        document.querySelector('meta[name="aphrody-rpc"]')?.getAttribute("content") === "unavailable",
      );
    }
  }, [
    currentPath,
    activeTab,
    activeTabId,
    updateTabPath,
    updateTabTitle,
    location.pathname,
    location.search,
    navigate,
  ]);

  return null;
}
