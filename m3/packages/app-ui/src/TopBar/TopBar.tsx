import { memo, useMemo } from "react";
import { TopBarSection } from "./Section";
import { useOverflowCalculation } from "./useOverflowCalculation";

interface TopBarProps {
	sidebarWidth?: number;
	inspectorWidth?: number;
	isPreviewActive?: boolean;
}

// Traffic lights on macOS are ~80px from left edge when sidebar is collapsed
const MACOS_TRAFFIC_LIGHT_WIDTH = 90;

// Detect macOS once
const isMacOS = typeof navigator !== 'undefined' &&
	(navigator.platform.toLowerCase().includes('mac') || navigator.userAgent.includes('Mac'));

function WindowControls() {
	if (typeof window === "undefined" || !window.__TAURI__ || isMacOS) return null;
	return (
		<div className="flex items-center gap-1 pl-2" data-tauri-drag-region="false" style={{ ["WebkitAppRegion" as any]: "no-drag" }}>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					if (window.__TAURI__?.core) {
						void window.__TAURI__.core.invoke("aphrody_shell_window", { action: { action: "minimize" } });
					}
				}}
				className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high transition-colors"
				title="Minimiser"
			>
				<span className="material-symbol text-[18px]">remove</span>
			</button>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					if (window.__TAURI__?.core) {
						void window.__TAURI__.core.invoke("aphrody_shell_window", { action: { action: "toggle_maximize" } });
					}
				}}
				className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high transition-colors"
				title="Agrandir / Restaurer"
			>
				<span className="material-symbol text-[18px]">crop_square</span>
			</button>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					if (window.__TAURI__?.core) {
						void window.__TAURI__.core.invoke("aphrody_shell_window", { action: { action: "close" } });
					}
				}}
				className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-error hover:text-on-error transition-colors"
				title="Fermer"
			>
				<span className="material-symbol text-[18px]">close</span>
			</button>
		</div>
	);
}

export const TopBar = memo(function TopBar({ sidebarWidth = 0, inspectorWidth = 0 }: TopBarProps) {
	const containerRef = useOverflowCalculation();

	const isSidebarCollapsed = sidebarWidth === 0;

	// Add padding for macOS traffic lights when sidebar is collapsed
	const leftPadding = useMemo(
		() => (isMacOS && isSidebarCollapsed ? MACOS_TRAFFIC_LIGHT_WIDTH : 0),
		[isSidebarCollapsed]
	);

	return (
		<div
			className="absolute top-0 z-[60] h-12"
			data-tauri-drag-region
			onDoubleClick={(e) => {
				if (e.target === e.currentTarget && typeof window !== "undefined" && window.__TAURI__?.core) {
					void window.__TAURI__.core.invoke("aphrody_shell_window", { action: { action: "toggle_maximize" } });
				}
			}}
			style={{
				left: sidebarWidth,
				right: inspectorWidth,
			}}
		>
			<div
				ref={containerRef}
				className="relative flex items-center h-full px-3 gap-3 overflow-hidden"
				data-tauri-drag-region
				onDoubleClick={(e) => {
					if (e.target === e.currentTarget && typeof window !== "undefined" && window.__TAURI__?.core) {
						void window.__TAURI__.core.invoke("aphrody_shell_window", { action: { action: "toggle_maximize" } });
					}
				}}
				style={{
					paddingLeft: leftPadding ? `${leftPadding}px` : undefined,
				}}
			>
				<TopBarSection position="left" />
				<TopBarSection position="center" />
				<button
					type="button"
					onClick={() => window.dispatchEvent(new CustomEvent("aphrody:open-command-palette"))}
					className="hidden sm:flex h-9 items-center gap-2 rounded-full bg-surface-container px-3 text-label-large text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors cursor-pointer border border-outline-variant/30 select-none shadow-xs"
					title="Ouvrir la palette de commandes (Ctrl+K)"
				>
					<span className="material-symbol text-[20px]">search</span>
					<span className="truncate">Recherche & commandes</span>
					<kbd className="ml-1 rounded bg-surface-container-highest px-2 py-0.5 text-label-medium font-mono text-on-surface">
						{isMacOS ? "⌘K" : "Ctrl+K"}
					</kbd>
				</button>
				<TopBarSection position="right" />
				<WindowControls />
			</div>
		</div>
	);
});