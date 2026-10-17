import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useExplorer } from "./context";
import { useTabManager } from "../../components/TabManager";

interface TabNavigationGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * TabNavigationGuard prevents rendering stale data during tab switches.
 *
 * When switching tabs, the activeTabId updates immediately but URL navigation
 * is async. This creates a brief window where the new tab's UI would render
 * the old tab's data. The guard blocks rendering ONLY during this window.
 *
 * Regular in-tab navigation (sidebar, breadcrumbs) is NOT blocked.
 */
export function TabNavigationGuard({ children, fallback }: TabNavigationGuardProps) {
  const { activeTabId } = useExplorer();
  const { tabs } = useTabManager();
  const location = useLocation();

  // Track when we last switched tabs
  const [tabSwitch, setTabSwitch] = useState({
    tabId: activeTabId,
    switchedAt: 0,
  });

  const activeTab = tabs.find(t => t.id === activeTabId);
  const currentUrlPath = location.pathname + location.search;

  // Detect tab switch and record timestamp (state update during render: React re-runs
  // this render with the recorded switch before anything is committed)
  if (tabSwitch.tabId !== activeTabId) {
    // oxlint-disable-next-line react/purity -- the guard window is a render-time clock by design (50 ms after the switch)
    setTabSwitch({ tabId: activeTabId, switchedAt: Date.now() });
  }

  // Check if we just switched tabs (within last 50ms)
  // oxlint-disable-next-line react/purity -- same render-time clock as the switch record above
  const justSwitchedTabs = Date.now() - tabSwitch.switchedAt < 50;

  // Only block if we JUST switched tabs AND URL hasn't caught up yet
  const isNavigating = justSwitchedTabs && activeTab && currentUrlPath !== activeTab.savedPath;

  if (isNavigating) {
    return fallback ?? <div className="h-full overflow-auto" />;
  }

  return <>{children}</>;
}
