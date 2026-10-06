// SPDX-License-Identifier: Apache-2.0
// Unified Workstation Router - Chat, Files and Models.
// Zero AI slop, zero dead routes, zero mock data.

import { createBrowserRouter, Navigate } from "react-router-dom";
import { legacyRouteRedirects } from "./desktop-navigation";
import { JobsScreen } from "./components/JobManager";
import { CodexChatRoute } from "./codex-chat";
import { ModelsHub } from "./models-hub";
import { StudioRoute } from "./routes/studio";
import { AdminRoute } from "./routes/admin";
import { CreatorRoute } from "./routes/creator";
import { ExplorerView } from "./routes/explorer";
import { RecentsView } from "./routes/explorer/views/RecentsView";
import { FileKindsView, FileKindResultsView } from "./routes/file-kinds";
import { AtRiskFiles, CompareVolumes, RedundancyDashboard } from "./routes/redundancy";
import { Settings } from "./routes/settings";
import { SourcesHome } from "./routes/sources";
import { SourceDetail } from "./routes/sources/SourceDetail";
import { AdaptersScreen } from "./routes/sources/Adapters";
import { TagView } from "./routes/tag";
import { ShellLayout } from "./ShellLayout";

/**
 * Unified application routes for the Spacedrive M3 Shell:
 * - "/": the file explorer, the desktop's default surface (redirects to "/explorer")
 * - "/explorer": Spacedrive VDFS Native File Explorer
 * - "/chat": Codex Chat (pixel-perfect Codex parity timeline + composer)
 * - "/models": Local Models Lifecycle & Hardware Telemetry
 * - "/settings": Desktop Preferences & Environment
 */
export const explorerRoutes = [
  {
    path: "/",
    element: <ShellLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/explorer" replace />,
      },
      {
        path: "chat",
        element: <CodexChatRoute />,
      },
      {
        path: "codex",
        element: <Navigate to={legacyRouteRedirects.codex} replace />,
      },
      {
        path: "explorer",
        element: <ExplorerView />,
      },
      {
        path: "models",
        element: <ModelsHub />,
      },
      {
        path: "studio",
        element: <StudioRoute />,
      },
      {
        path: "creator",
        element: <CreatorRoute />,
      },
      {
        path: "admin",
        element: <AdminRoute />,
      },
      {
        path: "favorites",
        element: <Navigate to={legacyRouteRedirects.favorites} replace />,
      },
      {
        path: "recents",
        element: <RecentsView />,
      },
      {
        path: "file-kinds",
        element: <FileKindsView />,
      },
      {
        path: "file-kinds/:kind",
        element: <FileKindResultsView />,
      },
      {
        path: "redundancy",
        element: <RedundancyDashboard />,
      },
      {
        path: "redundancy/at-risk",
        element: <AtRiskFiles />,
      },
      {
        path: "redundancy/compare",
        element: <CompareVolumes />,
      },
      {
        path: "tag/:tagId",
        element: <TagView />,
      },
      {
        path: "sources",
        element: <SourcesHome />,
      },
      {
        path: "sources/adapters",
        element: <AdaptersScreen />,
      },
      {
        path: "sources/:sourceId",
        element: <SourceDetail />,
      },
      {
        path: "search",
        element: <Navigate to={legacyRouteRedirects.search} replace />,
      },
      {
        path: "jobs",
        element: <JobsScreen />,
      },
      {
        path: "tasks",
        element: <Navigate to={legacyRouteRedirects.tasks} replace />,
      },
      {
        path: "settings",
        element: <Settings embedded />,
      },
    ],
  },
];

/**
 * Router instance for the main desktop interface
 */
export function createExplorerRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(explorerRoutes);
}
