// SPDX-License-Identifier: MIT OR Apache-2.0
// Main entrypoint for @aphrody/koharu-ui

// App components
export { KoharuApp } from "./components/app/KoharuApp";
export { StartupView } from "./components/app/StartupView";
export { TitleBar } from "./components/app/TitleBar";
export { AboutDialog } from "./components/app/AboutDialog";
export { WindowControls, useMacOS } from "./components/app/WindowChrome";
export { Updater } from "./components/app/Updater";

// Editor components
export { Editor } from "./components/editor/Editor";
export { CanvasWorkspace } from "./components/editor/CanvasWorkspace";
export { Inspector } from "./components/editor/Inspector";
export { PageRail } from "./components/editor/PageRail";
export { ToolBar } from "./components/editor/ToolBar";
export { StatusBar } from "./components/editor/StatusBar";
export { SelectionControls } from "./components/editor/SelectionControls";
export { InferenceControl } from "./components/editor/InferenceControl";
export { AgentPanel } from "./components/editor/AgentPanel";
export { ActivityCenter } from "./components/editor/ActivityCenter";
export { ResourceMonitor } from "./components/editor/ResourceMonitor";
export { RightSidebar } from "./components/editor/RightSidebar";
export { CanvasCommandBar } from "./components/editor/CanvasCommandBar";
export { CanvasOverlay } from "./components/editor/CanvasOverlay";
export { useCanvas } from "./components/editor/useCanvas";

// Start view
export { StartView } from "./components/start/StartView";

// Preferences & Settings
export { KoharuSettings, type KoharuSettingsHost } from "./components/preferences/KoharuSettings";
export { SettingsPage } from "./components/preferences/SettingsPage";
export { PipelinePreferences } from "./components/preferences/PipelinePreferences";
export { ProviderPreferences } from "./components/preferences/ProviderPreferences";
export { TranslationPreferences } from "./components/preferences/TranslationPreferences";
export { TypesettingPreferences } from "./components/preferences/TypesettingPreferences";
export { GenerationPreferences } from "./components/preferences/GenerationPreferences";
export { PreferencePage, PreferenceSection, PreferenceRow, TextField, NumberField } from "./components/preferences/PreferenceFields";

// Controls
export { FontPicker } from "./components/controls/FontPicker";
export { ColorWell } from "./components/controls/ColorWell";
export { useColorSampling, type ColorSampling } from "./components/controls/ColorSampling";
export { CommitTextarea } from "./components/controls/CommitTextarea";
export { ModelPicker } from "./components/controls/ModelPicker";
export { OutputPicker } from "./components/controls/OutputPicker";

// Providers & utilities
export { default as Providers } from "./providers";
export * as navigation from "./navigation";
export { ClientOnly } from "./components/ClientOnly";

// State and stores
export * from "./lib/store";
export * from "./lib/queries";
export * from "./lib/geometry";
export * as backend from "./lib/backend";
