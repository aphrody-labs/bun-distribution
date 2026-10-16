// SPDX-License-Identifier: Apache-2.0
// Unified Aphrody UI - Canonical exports for shell, explorer and M3 integration.

// oxlint-disable-next-line import/no-unassigned-import -- feuille de style globale de l'UI (effet de bord voulu)
import "./styles.css";

export { Shell } from "./Shell";
export { ShellLayout } from "./ShellLayout";
export { CommandPalette } from "./CommandPalette";
export { QuickBar } from "./quickbar";
export { explorerRoutes } from "./router";
export type { RouteObject } from "react-router-dom";
export { ExplorerView } from "./routes/explorer";
export { DemoWindow } from "./windows/DemoWindow";
export { ErrorBoundary } from "./components/ErrorBoundary";
export { FloatingControls } from "./windows/FloatingControls";
export { Inspector, PopoutInspector } from "./components/Inspector/Inspector";
export type { InspectorVariant } from "./components/Inspector/Inspector";
export { QuickPreview } from "./components/QuickPreview";
export { JobsScreen } from "./components/JobManager";
export {
  JobsProvider,
  useJobsContext,
} from "./components/JobManager/hooks/JobsContext";
export { Settings } from "./routes/settings";
export { Spacedrop } from "./windows/Spacedrop";
export { PairingModal } from "./components/modals/PairingModal";
export { TopBarProvider, TopBarPortal, useTopBar } from "./TopBar";

// Platform abstraction
export type { Platform } from "./contexts/PlatformContext";
export { PlatformProvider, usePlatform } from "./contexts/PlatformContext";

// Context
export { SpacedriveProvider } from "./contexts/SpacedriveContext";
export {
  ServerProvider,
  useServer,
  type ServerContextValue,
} from "./contexts/ServerContext";

// Hooks
export { useContextMenu } from "./hooks/useContextMenu";
export type {
  ContextMenuItem,
  ContextMenuConfig,
} from "./hooks/useContextMenu";

// Keybind hooks
export { useKeybind } from "./hooks/useKeybind";
export type { KeybindHandler, UseKeybindOptions } from "./hooks/useKeybind";
export { useKeybindScope, isScopeActive } from "./hooks/useKeybindScope";
export {
  useKeybindMeta,
  useKeybindDisplayString,
} from "./hooks/useKeybindMeta";
export type { KeybindMeta } from "./hooks/useKeybindMeta";

// Clipboard hook
export { useClipboard, useClipboardStore } from "./hooks/useClipboard";
export type { ClipboardState } from "./hooks/useClipboard";

// Keybind utilities
export {
  KEYBINDS,
  getKeybind,
  getAllKeybinds,
  getKeybindsByScope,
  getCurrentPlatform,
  getComboForPlatform,
  toDisplayString,
} from "./util/keybinds";
export type {
  KeybindId,
  KeybindScope,
  KeybindDefinition,
  KeyCombo,
} from "./util/keybinds";
