import type { ReactNode } from "react";
import {
	Activity,
	Database,
	Clock,
	Wrench,
	Bot,
	LogOut,
	Home,
	BarChart3,
	FileText,
	Settings as SettingsIcon,
	Terminal,
	Trophy,
	MessageSquare,
	Image as ImageIcon,
	User as UserIcon,
	Webhook as WebhookIcon,
	ShieldAlert,
	Crown,
	Ticket as TicketIcon,
	FileSearch,
	ShoppingBag,
	Sparkles,
	SlashSquare,
	Gift,
	Coins,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

interface SessionUser {
	id?: string;
	username?: string;
	avatar?: string | null;
	avatarUrl?: string;
	email?: string | null;
	source: "token" | "discord";
}

const NAV = [
	{ path: "/", label: "Tableau de bord", icon: Home },
	{ path: "/profile", label: "Mon profil Discord", icon: UserIcon },
	{ path: "/bot", label: "Bot · 44 commandes", icon: Bot },
	{ path: "/commands", label: "Permissions commandes", icon: SlashSquare },
	{ path: "/database", label: "Base de données · 16 tables", icon: Database },
	{ path: "/cron", label: "Tâches planifiées · 3", icon: Clock },
	{ path: "/services", label: "Services · 15 actions", icon: Wrench },
	{ path: "/levels", label: "Niveaux & XP", icon: Trophy },
	{ path: "/economy", label: "Économie", icon: Coins },
	{ path: "/messages", label: "Messages du bot", icon: MessageSquare },
	{ path: "/webhooks", label: "Webhooks", icon: WebhookIcon },
	{ path: "/canvas", label: "Aperçu canvas", icon: ImageIcon },
	{ path: "/stats", label: "Statistiques", icon: BarChart3 },
	{ path: "/moderation", label: "Modération", icon: ShieldAlert },
	{ path: "/hierarchy", label: "Hiérarchie staff", icon: Crown },
	{ path: "/tickets", label: "Tickets", icon: TicketIcon },
	{ path: "/giveaways", label: "Giveaways", icon: Gift },
	{ path: "/shop", label: "Shop · CRUD", icon: ShoppingBag },
	{ path: "/triggers", label: "Triggers de succès", icon: Sparkles },
	{ path: "/audit-internal", label: "Journal interne", icon: FileSearch },
	{ path: "/audit", label: "Journal d'audit", icon: FileText },
	{ path: "/logs", label: "Journaux du service", icon: Terminal },
	{ path: "/settings", label: "Configuration", icon: SettingsIcon },
];

interface Props {
	route: string;
	navigate: (path: string) => void;
	children: ReactNode;
}

export function Layout({ route, navigate, children }: Props) {
	const me = useQuery({
		queryKey: ["auth", "me"],
		queryFn: () => api.get<{ authenticated: boolean; user?: SessionUser }>("/auth/me"),
		refetchInterval: 0,
		staleTime: 60_000,
	});
	const user = me.data?.user;
	const logout = async () => {
		await api.post("/auth/logout").catch(() => {});
		window.location.href = "/login";
	};

	return (
		<div className="flex min-h-screen">
			<aside className="sticky top-0 hidden h-screen w-72 flex-col border-r border-zinc-800 bg-zinc-950/80 backdrop-blur md:flex">
				<div className="flex items-center gap-3 border-b border-zinc-800 p-6">
					<img
						src="/assets/logo.webp"
						alt="Shenron"
						className="h-10 w-10 rounded-lg object-cover"
					/>
					<div>
						<h1 className="font-bold text-brand-400">Shenron</h1>
						<p className="text-xs text-zinc-500">Tableau de bord admin</p>
					</div>
				</div>

				<nav className="flex-1 space-y-1 p-3">
					{NAV.map(({ path, label, icon: Icon }) => {
						const active = route === path || (path !== "/" && route.startsWith(path));
						return (
							<button
								key={path}
								type="button"
								onClick={() => navigate(path)}
								className={cn(
									"flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
									active
										? "bg-brand-500/10 text-brand-400"
										: "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
								)}
							>
								<Icon className="h-4 w-4 shrink-0" />
								<span className="truncate">{label}</span>
							</button>
						);
					})}
				</nav>

				<div className="space-y-2 border-t border-zinc-800 p-3">
					{user?.id && user.avatarUrl && (
						<div className="flex items-center gap-3 rounded-lg bg-zinc-900/40 p-2">
							<img
								src={user.avatarUrl}
								alt={user.username ?? ""}
								className="h-9 w-9 rounded-full object-cover"
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium text-zinc-100">{user.username}</p>
								<p className="truncate text-xs text-zinc-500">{user.email ?? `ID ${user.id}`}</p>
							</div>
						</div>
					)}
					{user && !user.id && (
						<p className="rounded-lg bg-zinc-900/40 p-2 text-xs text-zinc-500">
							Session jeton (admin token)
						</p>
					)}
					<button type="button" onClick={logout} className="btn btn-ghost w-full justify-start">
						<LogOut className="h-4 w-4" />
						Déconnexion
					</button>
				</div>
			</aside>

			<main className="flex-1 overflow-x-hidden">
				<header className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-800 bg-zinc-950/90 px-6 py-3 backdrop-blur">
					<Activity className="h-4 w-4 text-brand-400" />
					<span className="text-sm font-medium text-zinc-300">{routeLabel(route)}</span>
				</header>
				<div className="p-6">{children}</div>
			</main>
		</div>
	);
}

function routeLabel(route: string): string {
	if (route === "/") return "Tableau de bord";
	if (route.startsWith("/database/"))
		return `Base de données · ${route.slice("/database/".length)}`;
	const match = NAV.find((n) => n.path === route);
	return match?.label ?? route;
}
