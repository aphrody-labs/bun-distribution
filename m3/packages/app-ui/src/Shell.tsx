import type { RouteObject } from "react-router-dom";
import { SpacedriveProvider, type SpacedriveClient } from "./contexts/SpacedriveContext";
import { ServerProvider } from "./contexts/ServerContext";
import { RouterProvider } from "react-router-dom";
import { Dialogs, Toaster, TooltipProvider } from "@aphrody/m3-primitives";

import { explorerRoutes } from "./router";
import { DndProvider } from "./components/DndProvider";
import {
	TabManagerProvider,
	TabKeyboardHandler,
	useTabManager,
} from "./components/TabManager";
import { usePlatform } from "./contexts/PlatformContext";
import { useTheme } from "./hooks/useTheme";

export interface ShellProps {
	client: SpacedriveClient;
	embedded?: boolean;
	routes?: RouteObject[];
}

function ThemeApplier() {
	useTheme();
	return null;
}

function ShellWithTabs({ embedded = false }: { embedded?: boolean }) {
	const { router } = useTabManager();

	return (
		<DndProvider>
			{!embedded && <ThemeApplier />}
			<RouterProvider router={router} />
		</DndProvider>
	);
}

/**
 * Tauri-specific wrapper that mounts the M3 ShellLayout and tab manager immediately,
 * without blocking UI rendering on daemon status.
 */
function ShellWithDaemonCheck({ embedded = false, routes }: { embedded?: boolean; routes?: RouteObject[] }) {
	return (
		<>
			<TabManagerProvider routes={routes ?? explorerRoutes}>
				<TabKeyboardHandler />
				<ShellWithTabs embedded={embedded} />
			</TabManagerProvider>
			<Dialogs />
			<Toaster />
		</>
	);
}

export function Shell({ client, embedded = false, routes }: ShellProps) {
	const platform = usePlatform();
	const isTauri = platform.platform === "tauri";

	return (
		<SpacedriveProvider client={client}>
			<ServerProvider>
				<TooltipProvider>
					{isTauri ? (
						<ShellWithDaemonCheck embedded={embedded} routes={routes} />
					) : (
						<>
							<TabManagerProvider routes={routes ?? explorerRoutes}>
								<TabKeyboardHandler />
								<ShellWithTabs embedded={embedded} />
							</TabManagerProvider>
							<Dialogs />
							<Toaster />
						</>
					)}
				</TooltipProvider>
			</ServerProvider>
		</SpacedriveProvider>
	);
}

