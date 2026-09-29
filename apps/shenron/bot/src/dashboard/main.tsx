import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";

// Inject favicons + manifest dynamically (Bun HTML bundler can't resolve absolute paths)
function injectIcons() {
	const head = document.head;
	const links: Array<[string, string, string?]> = [
		["icon", "/favicon-32.png", "image/png"],
		["icon", "/favicon-16.png", "image/png"],
		["icon", "/favicon-96.png", "image/png"],
		["apple-touch-icon", "/apple-touch-icon.png"],
		["icon", "/favicon.ico"],
		["manifest", "/manifest.webmanifest"],
	];
	for (const [rel, href, type] of links) {
		const link = document.createElement("link");
		link.rel = rel;
		link.href = href;
		if (type) link.type = type;
		head.appendChild(link);
	}
}
injectIcons();
// CSS is loaded via <link> in dashboard.html (pre-compiled by `bun run dashboard:css`).
// Importing here would bypass the compiled file and let Bun bundle the raw @import "tailwindcss"
// without the Tailwind plugin → no utility classes generated.

// refetchInterval *opt-in* par page (Overview/Logs/Stats déclarent leur propre
// interval). staleTime 30 s + gcTime 5 min mutualise les clés cross-pages.
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: true,
			staleTime: 30_000,
			gcTime: 5 * 60_000,
			retry: 1,
		},
	},
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<App />
		</QueryClientProvider>
	</StrictMode>
);
