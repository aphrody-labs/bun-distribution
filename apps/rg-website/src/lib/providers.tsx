"use client";

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import React from "react";

export function Providers({ children }: { children: React.ReactNode }) {
	const [queryClient] = React.useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						gcTime: 1000 * 60 * 60 * 24, // 24 hours
					},
				},
			})
	);

	React.useEffect(() => {
		const localStoragePersister = createSyncStoragePersister({
			storage: window.localStorage,
		});
		persistQueryClient({
			persister: localStoragePersister,
			queryClient,
		});
	}, [queryClient]);

	// Le SidebarProvider réel (état contrôlé + persistance) vit dans
	// SidebarWrapper (client-layout.tsx) — un second ici serait un doublon
	// (double listener clavier ⌘B, double cookie, double TooltipProvider).
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
