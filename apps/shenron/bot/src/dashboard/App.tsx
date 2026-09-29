import { useEffect, useState, lazy, Suspense } from "react";
import { Layout } from "./components/Layout";
import { DiscordLoginPrompt } from "./components/DiscordLoginPrompt";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { api } from "./lib/api";
import { useEventStream } from "./lib/event-stream";

// Pages lazy — code-split par route. Bun bundler génère un chunk par import().
// Login + Overview restent eager (route critique au boot, ~70% du trafic dashboard).
const Database = lazy(() => import("./pages/Database").then((m) => ({ default: m.Database })));
const TableView = lazy(() => import("./pages/TableView").then((m) => ({ default: m.TableView })));
const Cron = lazy(() => import("./pages/Cron").then((m) => ({ default: m.Cron })));
const Services = lazy(() => import("./pages/Services").then((m) => ({ default: m.Services })));
const Bot = lazy(() => import("./pages/Bot").then((m) => ({ default: m.Bot })));
const Stats = lazy(() => import("./pages/Stats").then((m) => ({ default: m.Stats })));
const Audit = lazy(() => import("./pages/Audit").then((m) => ({ default: m.Audit })));
const Moderation = lazy(() =>
	import("./pages/Moderation").then((m) => ({ default: m.Moderation }))
);
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Logs = lazy(() => import("./pages/Logs").then((m) => ({ default: m.Logs })));
const Levels = lazy(() => import("./pages/Levels").then((m) => ({ default: m.Levels })));
const Messages = lazy(() => import("./pages/Messages").then((m) => ({ default: m.Messages })));
const CanvasPage = lazy(() => import("./pages/Canvas").then((m) => ({ default: m.CanvasPage })));
const Profile = lazy(() => import("./pages/Profile").then((m) => ({ default: m.Profile })));
const Webhooks = lazy(() => import("./pages/Webhooks").then((m) => ({ default: m.Webhooks })));
const Hierarchy = lazy(() => import("./pages/Hierarchy").then((m) => ({ default: m.Hierarchy })));
const Tickets = lazy(() => import("./pages/Tickets").then((m) => ({ default: m.Tickets })));
const AuditInternal = lazy(() =>
	import("./pages/AuditInternal").then((m) => ({ default: m.AuditInternal }))
);
const Shop = lazy(() => import("./pages/Shop").then((m) => ({ default: m.Shop })));
const Triggers = lazy(() => import("./pages/Triggers").then((m) => ({ default: m.Triggers })));
const Commands = lazy(() => import("./pages/Commands").then((m) => ({ default: m.Commands })));
const Giveaways = lazy(() => import("./pages/Giveaways").then((m) => ({ default: m.Giveaways })));
const Economy = lazy(() => import("./pages/Economy").then((m) => ({ default: m.Economy })));

interface SessionUser {
	id?: string;
	username?: string;
	avatar?: string | null;
	source: "token" | "discord" | "better-auth";
}
interface Session {
	authenticated: boolean;
	checkedAt: number;
	user?: SessionUser;
}

const PageFallback = (
	<div className="flex min-h-[40vh] items-center justify-center text-zinc-500">
		<div className="animate-pulse">Chargement de la page…</div>
	</div>
);

export function App() {
	const [session, setSession] = useState<Session | null>(null);
	const [route, setRoute] = useState<string>(() => window.location.pathname);

	// Sync live bot ↔ dashboard via SSE — actif uniquement quand authentifié
	useEventStream(!!session?.authenticated);

	useEffect(() => {
		const onPop = () => setRoute(window.location.pathname);
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	useEffect(() => {
		api
			.get<{ authenticated: boolean; user?: SessionUser }>("/auth/me")
			.then((r) =>
				setSession({
					authenticated: r.authenticated,
					user: r.user,
					checkedAt: Date.now(),
				})
			)
			.catch(() => setSession({ authenticated: false, checkedAt: Date.now() }));
	}, []);

	if (!session) {
		return (
			<div className="flex min-h-screen items-center justify-center text-zinc-500">
				<div className="animate-pulse">Chargement en cours…</div>
			</div>
		);
	}

	if (!session.authenticated) {
		return <Login onLogin={() => setSession({ authenticated: true, checkedAt: Date.now() })} />;
	}

	const navigate = (path: string) => {
		window.history.pushState({}, "", path);
		setRoute(path);
	};

	return (
		<>
			<Layout route={route} navigate={navigate}>
				<Suspense fallback={PageFallback}>{renderRoute(route, navigate)}</Suspense>
			</Layout>
			<DiscordLoginPrompt visible={session.user?.source === "token"} />
		</>
	);
}

function renderRoute(route: string, navigate: (path: string) => void) {
	if (route === "/" || route === "") return <Overview />;
	if (route === "/profile") return <Profile />;
	if (route === "/webhooks") return <Webhooks />;
	if (route === "/cron") return <Cron />;
	if (route === "/services") return <Services />;
	if (route === "/bot") return <Bot />;
	if (route === "/stats") return <Stats />;
	if (route === "/levels") return <Levels />;
	if (route === "/messages") return <Messages />;
	if (route === "/canvas") return <CanvasPage />;
	if (route === "/audit") return <Audit />;
	if (route === "/moderation") return <Moderation />;
	if (route === "/hierarchy") return <Hierarchy />;
	if (route === "/tickets") return <Tickets />;
	if (route === "/audit-internal") return <AuditInternal />;
	if (route === "/shop") return <Shop />;
	if (route === "/triggers") return <Triggers />;
	if (route === "/commands") return <Commands />;
	if (route === "/giveaways") return <Giveaways />;
	if (route === "/economy") return <Economy />;
	if (route === "/logs") return <Logs />;
	if (route === "/settings") return <Settings />;
	if (route === "/database") return <Database navigate={navigate} />;
	if (route.startsWith("/database/")) {
		const table = route.slice("/database/".length);
		return <TableView table={table} navigate={navigate} />;
	}
	return (
		<div className="card text-center">
			<h2 className="mb-2 text-2xl">Page introuvable</h2>
			<p className="text-zinc-400">Aucune route ne correspond à : {route}</p>
		</div>
	);
}
