"use client";

import { ArrowLeft, CircleUser, Home, LayoutDashboard, Menu, Settings, User } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSidebar } from "@rosegriffon/ui";
import { ThemeToggle } from "./ThemeToggle";
import { UnifiedSearchBar } from "./UnifiedSearchBar";
import { BASE_ADMIN } from "../config/routes";
import { UniverseSwitch } from "./UniverseSwitch";

export interface UserProfile {
	username?: string | null;
	avatar_url?: string | null;
	role?: string | null;
}

export interface TopAppBarProps {
	appName?: string;
	logoSrc?: string;
	homeHref?: string;
	/** Retour au portail Rose Griffon, distinct de l'accueil de l'univers courant. */
	portalHref?: string;
	adminHref?: string;
	settingsHref?: string;
	isAdmin?: boolean;
	showUniverseSwitch?: boolean;
	user?: unknown | null;
	profile?: UserProfile | null;
	searchSlot?: React.ReactNode;
	notificationsSlot?: React.ReactNode;
	themeToggleSlot?: React.ReactNode;
	loginSlot?: React.ReactNode;
	accountHref?: string;
	titleMap?: Record<string, string>;
	isMobile?: boolean;
	showSearch?: boolean;
	showCart?: boolean;
	showSidebarToggle?: boolean;
	showActions?: boolean;
	showSettings?: boolean;
	className?: string;
}

const DEFAULT_TITLE_MAP: Record<string, string> = {
	"/wiki": "Wiki",
	"/search": "Recherche",
	"/news": "Actualités",
	"/patch-notes": "Patch Notes",
	"/chara": "Joueurs",
	"/skill": "Techniques",
	"/item": "Objets",
	"/aura": "Hyper Techniques",
	"/passive": "Passifs",
	"/tactic": "Tactiques",
	"/team": "Équipes",
	"/equipe": "Équipes",
	"/tools": "Outils",
	"/settings": "Paramètres",
	"/admin": "Administration",
	"/achillea": "E-Sport",
	"/achillea/clans": "Clans E-Sport",
	"/achillea/ranked": "Mode Classé",
	"/achillea/tournaments": "Tournois E-Sport",
	"/achillea/leagues": "Astral League",
	"/evenements": "Événements",
	"/community": "Communauté",
	"/shop": "Boutique",
	"/sondages": "Sondages",
	"/projets": "Projets",
	"/rose-griffon-tv": "Rose Griffon TV",
	"/profil": "Profil",
	"/a-propos": "À propos",
};

export function resolvePageTitle(pathname: string, titleMap = DEFAULT_TITLE_MAP): string {
	if (pathname === "/" || pathname === "") {
		return "";
	}
	for (const [prefix, title] of Object.entries(titleMap)) {
		if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
			return title;
		}
	}
	return "";
}

export function MobileHeader({
	appName = "Rose Griffon",
	logoSrc = "/RG_Logo_V2.5.webp",
	homeHref = "/",
	portalHref = "/",
	adminHref = BASE_ADMIN,
	settingsHref = "/settings",
	isAdmin = false,
	showUniverseSwitch = false,
	user = null,
	profile = null,
	notificationsSlot,
	themeToggleSlot,
	loginSlot,
	accountHref,
	showSettings = true,
	titleMap = DEFAULT_TITLE_MAP,
	className,
}: TopAppBarProps) {
	const router = useRouter();
	const { toggleSidebar, openMobile } = useSidebar();
	const [isScrolled, setIsScrolled] = useState(false);
	const pathname = usePathname() || "/";

	useEffect(() => {
		const handleScroll = () => setIsScrolled(window.scrollY > 0);
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	const isHome = pathname === "/" || pathname === homeHref;
	const title = resolvePageTitle(pathname, titleMap);
	const loginHref = pathname.startsWith("/achillea")
		? `/login?redirect=${encodeURIComponent(pathname)}`
		: "/login";

	const publicProfileHref =
		accountHref && accountHref !== "/settings"
			? accountHref
			: profile?.username
				? `/profil/${encodeURIComponent(profile.username)}`
				: "/profil";

	return (
		<header
			className={`fixed top-0 left-0 right-0 z-40 flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-2 px-4 pt-safe md:hidden transition-[background-color,box-shadow] duration-300 motion-standard ${
				isScrolled ? "bg-sidebar/95 backdrop-blur-xl elevation-1" : "bg-sidebar"
			} ${className ?? ""}`}
		>
			<button
				onClick={toggleSidebar}
				className="size-12 flex items-center justify-center text-sidebar-foreground hover:bg-sidebar-accent rounded-full transition-colors -ml-1"
				aria-label="Ouvrir le menu"
				aria-expanded={openMobile}
			>
				<Menu size={24} aria-hidden="true" />
			</button>

			{isHome || !title ? (
				<Link href={homeHref} className="flex items-center gap-1.5 shrink-0 ml-1">
					<div className="relative size-7">
						<Image src={logoSrc} fill sizes="28px" alt={appName} className="object-contain" />
					</div>
					<span className="type-title-large text-sidebar-foreground">{appName}</span>
				</Link>
			) : (
				<span className="type-title-large text-sidebar-foreground truncate ml-1">{title}</span>
			)}

			<div className="flex-1" />
			{showUniverseSwitch && (
				<div className="flex items-center mr-1">
					<UniverseSwitch className="scale-90" />
				</div>
			)}
			<div className="flex items-center gap-0.5">
				<Link
					href={portalHref}
					className="size-12 rounded-full flex items-center justify-center text-sidebar-foreground/85 hover:bg-sidebar-accent active:bg-sidebar-accent transition-colors"
					aria-label="Accueil Rose Griffon"
					title="Accueil"
				>
					<Home size={22} aria-hidden="true" />
				</Link>
				{isAdmin && (
					<Link
						href={adminHref}
						className="size-12 rounded-full flex items-center justify-center text-sidebar-foreground/85 hover:bg-sidebar-accent active:bg-sidebar-accent transition-colors"
						aria-label="Administration"
					>
						<LayoutDashboard size={24} aria-hidden="true" />
					</Link>
				)}

				{notificationsSlot}

				{themeToggleSlot ?? (
					<ThemeToggle className="size-12 !text-sidebar-foreground hover:!bg-sidebar-accent" />
				)}

				{showSettings && (
					<Link
						href={settingsHref}
						className="size-12 rounded-full flex items-center justify-center text-sidebar-foreground/85 hover:bg-sidebar-accent active:bg-sidebar-accent transition-colors"
						aria-label="Paramètres"
						title="Paramètres"
					>
						<Settings size={24} aria-hidden="true" />
					</Link>
				)}

				<div className="ml-1">
					{user ? (
						<button
							className="size-12 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0 active:scale-95 transition-transform"
							onClick={() => router.push(publicProfileHref)}
							aria-label={
								profile?.username ? `Profil public de ${profile.username}` : "Profil public"
							}
							title={profile?.username ? `Profil public de ${profile.username}` : "Profil public"}
						>
							{profile?.avatar_url ? (
								<Image
									src={profile.avatar_url}
									alt=""
									width={48}
									height={48}
									className="w-full h-full object-cover"
									unoptimized
								/>
							) : (
								<User size={24} className="text-primary" aria-hidden="true" />
							)}
						</button>
					) : (
						(loginSlot ?? (
							<Link
									href={loginHref}
								className="size-12 rounded-full flex items-center justify-center text-sidebar-foreground/85 hover:bg-sidebar-accent active:bg-sidebar-accent transition-colors"
								aria-label="Se connecter"
							>
								<CircleUser size={24} aria-hidden="true" />
							</Link>
						))
					)}
				</div>
			</div>
		</header>
	);
}

export function DesktopTopBar({
	appName = "Rose Griffon",
	logoSrc = "/RG_Logo_V2.5.webp",
	homeHref = "/",
	portalHref = "/",
	adminHref = BASE_ADMIN,
	settingsHref = "/settings",
	isAdmin = false,
	showUniverseSwitch = true,
	user = null,
	profile = null,
	searchSlot,
	showSearch = true,
	notificationsSlot,
	themeToggleSlot,
	loginSlot,
	accountHref,
	showSettings = true,
	titleMap = DEFAULT_TITLE_MAP,
	className,
}: TopAppBarProps) {
	const pathname = usePathname() || "/";
	const router = useRouter();
	const { toggleSidebar, open } = useSidebar();
	const title = resolvePageTitle(pathname, titleMap);
	const isHome = pathname === "/" || pathname === homeHref;
	const loginHref = pathname.startsWith("/achillea")
		? `/login?redirect=${encodeURIComponent(pathname)}`
		: "/login";
	const goBack = () => (window.history.length > 1 ? router.back() : router.push(homeHref));

	const publicProfileHref =
		accountHref && accountHref !== "/settings"
			? accountHref
			: profile?.username
				? `/profil/${encodeURIComponent(profile.username)}`
				: "/profil";

	return (
		<header
			className={`fixed top-0 left-0 right-0 z-[60] flex h-14 items-center justify-between px-4 bg-sidebar/95 text-sidebar-foreground backdrop-blur-xl border-b border-sidebar-border max-md:hidden ${
				className ?? ""
			}`}
		>
			{/* Left: Burger + Logo + UniverseSwitch + (Optional) Title */}
			<div className="flex items-center gap-1.5 min-w-[220px]">
				{!isHome && (
					<button
						type="button"
						onClick={goBack}
						className="size-10 rounded-full flex items-center justify-center text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
						aria-label="Revenir à la page précédente"
						title="Retour"
					>
						<ArrowLeft size={20} aria-hidden="true" />
					</button>
				)}
				<button
					onClick={toggleSidebar}
					className="size-10 rounded-full flex items-center justify-center text-sidebar-foreground hover:bg-sidebar-accent active:bg-sidebar-accent transition-colors"
					aria-label="Ouvrir le menu"
					aria-expanded={open}
				>
					<Menu size={24} aria-hidden="true" />
				</button>
				<Link
					href={portalHref}
					className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
					aria-label="Accueil Rose Griffon"
					title="Accueil Rose Griffon"
				>
					<Home size={19} aria-hidden="true" />
					<span className="hidden xl:inline">Accueil</span>
				</Link>
				<Link href={homeHref} className="flex items-center gap-2 group px-2">
					<div className="relative size-7 shrink-0 transition-transform group-hover:scale-105">
						<Image src={logoSrc} fill sizes="28px" alt={appName} className="object-contain" />
					</div>
					<span className="font-expressive-title text-xl text-sidebar-foreground transition-all duration-500 group-hover:font-width-expanded">
						{appName}
					</span>
				</Link>

				{showUniverseSwitch && (
					<div className="ml-3 hidden sm:flex items-center">
						<UniverseSwitch />
					</div>
				)}

				{title && (
					<div className="flex items-center gap-2 ml-2 animate-in fade-in slide-in-from-left-2 duration-300">
						<span className="size-1 rounded-full bg-sidebar-foreground/60" />
						<span className="font-semibold text-sm text-sidebar-foreground tracking-wide mt-0.5 truncate max-w-[180px]">
							{title}
						</span>
					</div>
				)}
			</div>

			{/* Center: Search Bar Slot or default UnifiedSearchBar */}
			<div className="flex items-center justify-center flex-1 max-w-[560px] px-4">
				{showSearch && (searchSlot ?? <UnifiedSearchBar />)}
			</div>

			{/* Right: Actions */}
			<div className="flex items-center justify-end gap-1 min-w-[200px]">
				{isAdmin && (
					<Link
						href={adminHref}
						className="size-10 rounded-full flex items-center justify-center text-sidebar-foreground/85 hover:bg-sidebar-accent active:bg-sidebar-accent transition-colors"
						aria-label="Administration"
						title="Administration"
					>
						<LayoutDashboard size={20} aria-hidden="true" />
					</Link>
				)}

				{notificationsSlot}

				{themeToggleSlot ?? (
					<ThemeToggle className="!text-sidebar-foreground hover:!bg-sidebar-accent" />
				)}

				{showSettings && (
					<Link
						href={settingsHref}
						className="size-10 rounded-full flex items-center justify-center text-sidebar-foreground/85 hover:bg-sidebar-accent active:bg-sidebar-accent transition-colors"
						aria-label="Paramètres"
						title="Paramètres"
					>
						<Settings size={20} aria-hidden="true" />
					</Link>
				)}

				<div className="ml-2">
					{user ? (
						<div
							className="size-9 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden transition-all duration-200 cursor-pointer hover:ring-2 hover:ring-primary/20 active:scale-95"
							onClick={() => router.push(publicProfileHref)}
							role="button"
							tabIndex={0}
							aria-label={
								profile?.username ? `Profil public de ${profile.username}` : "Profil public"
							}
							title={profile?.username ? `Profil public de ${profile.username}` : "Profil public"}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									router.push(publicProfileHref);
								}
							}}
						>
							{profile?.avatar_url ? (
								<Image
									src={profile.avatar_url}
									alt=""
									width={36}
									height={36}
									className="w-full h-full object-cover"
									unoptimized
								/>
							) : (
								<User size={18} className="text-primary" aria-hidden="true" />
							)}
						</div>
					) : (
						(loginSlot ?? (
							<Link
								href={loginHref}
								className="h-9 px-4 rounded-full flex items-center gap-2 text-sidebar-foreground type-label-large hover:bg-sidebar-accent active:bg-sidebar-accent transition-colors duration-200"
							>
								<CircleUser size={20} aria-hidden="true" />
								Connexion
							</Link>
						))
					)}
				</div>
			</div>
		</header>
	);
}

export function TopAppBar(props: TopAppBarProps) {
	if (props.isMobile) {
		return <MobileHeader {...props} />;
	}
	return <DesktopTopBar {...props} />;
}

export { TopAppBar as Header };
export default TopAppBar;
