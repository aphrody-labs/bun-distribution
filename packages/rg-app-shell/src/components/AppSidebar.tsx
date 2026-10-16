"use client";

import { ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "@rosegriffon/ui";
import {
	domaineDeLaRoute,
	filtrerNavigation,
	itemsDeNavigation,
	estItemActif,
	type Domaine,
	type NavItem,
} from "../config/navigation";
import { iconMap } from "../lib/icons";
import { traduireNav } from "../lib/translations";

export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
	items?: NavItem[];
	isAdmin?: boolean;
	/** Filtre récursif des destinations selon la session de l'application hôte. */
	canView?: (item: NavItem) => boolean;
	t?: (key: string) => string;
	renderIcon?: (item: NavItem) => React.ReactNode;
	headerSlot?: React.ReactNode;
	footerSlot?: React.ReactNode;
}

/**
 * En-tête dynamique de la barre latérale :
 * Affiche l'identité du domaine actif (Rose Griffon, Azalée, Achilléa)
 * et propose un switch d'univers instantané sans casser le layout.
 */
export function SidebarUniverseHeader({
	pathname,
	isCollapsed,
}: {
	pathname: string;
	isCollapsed: boolean;
}) {
	const activeDomaine = domaineDeLaRoute(pathname);

	const info: Record<
		Domaine,
		{
			name: string;
			badge: string;
			logo: string;
			href: string;
			badgeColor: string;
		}
	> = {
		association: {
			name: "Rose Griffon",
			badge: "Association",
			logo: "/RG_Logo_V2.5.webp",
			href: "/",
			badgeColor: "bg-primary/10 text-primary border-primary/20",
		},
		wiki: {
			name: "Azalée",
			badge: "Wiki VR",
			logo: "/RG_Azalee-logo.webp",
			href: "/wiki",
			badgeColor: "bg-secondary/15 text-secondary border-secondary/30",
		},
		esport: {
			name: "Achilléa",
			badge: "E-Sport",
			logo: "/achillea/logo1.svg",
			href: "/achillea",
			badgeColor:
				"bg-achillea-violet/15 dark:bg-achillea-lime/20 text-achillea-violet dark:text-achillea-lime border-achillea-violet/30 dark:border-achillea-lime/40",
		},
	};

	const current = info[activeDomaine];

	if (isCollapsed) {
		return (
			<SidebarHeader className="p-2 flex items-center justify-center border-b border-sidebar-border">
				<Link
					href={current.href}
					className="relative size-10 rounded-xl p-1.5 flex items-center justify-center text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
					title={`${current.name} — ${current.badge}`}
				>
					<Image
						src={current.logo}
						alt={current.name}
						fill
						sizes="32px"
						className="object-contain"
					/>
				</Link>
			</SidebarHeader>
		);
	}

	return (
		<SidebarHeader className="p-3 border-b border-sidebar-border space-y-2.5 text-sidebar-foreground">
			{/* Univers Identity */}
			<div className="flex items-center justify-between gap-2">
				<Link href={current.href} className="flex items-center gap-2.5 min-w-0 group/brand flex-1">
					<div className="relative size-8 shrink-0 rounded-lg overflow-hidden p-0.5 bg-sidebar-accent border border-sidebar-border group-hover/brand:scale-105 transition-transform">
						<Image
							src={current.logo}
							alt={current.name}
							fill
							sizes="32px"
							className="object-contain"
						/>
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							<span className="font-black text-sm text-sidebar-foreground truncate transition-colors">
								{current.name}
							</span>
							<span
								className={`text-xs font-bold px-1.5 py-0.5 rounded border ${current.badgeColor}`}
							>
								{current.badge}
							</span>
						</div>
					</div>
				</Link>
			</div>
		</SidebarHeader>
	);
}

function NavIcon({
	item,
	isActive,
	isCollapsed,
	depth,
	t,
	renderIcon,
}: {
	item: NavItem;
	isActive: boolean;
	isCollapsed: boolean;
	depth: number;
	t?: (key: string) => string;
	renderIcon?: (item: NavItem) => React.ReactNode;
}) {
	const customIcon = renderIcon ? renderIcon(item) : null;
	if (customIcon) {
		return <>{customIcon}</>;
	}

	const LucideIcon = iconMap[item.icon];

	if (item.imageUrl) {
		return (
			<div className="relative size-full">
				<Image
					src={item.imageUrl}
					alt={traduireNav(item.label, t)}
					fill
					className={`object-contain ${
						isActive
							? "opacity-100"
							: "opacity-70 grayscale group-hover:grayscale-0 group-hover:opacity-100"
					}`}
				/>
			</div>
		);
	}

	if (LucideIcon) {
		return (
			<LucideIcon
				size={isCollapsed && depth === 0 ? 24 : 20}
				fill={isActive ? "currentColor" : "none"}
				aria-hidden="true"
			/>
		);
	}

	return null;
}

function RecursiveNavItem({
	item,
	pathname,
	depth = 0,
	t,
	renderIcon,
}: {
	item: NavItem;
	pathname: string;
	depth?: number;
	t?: (key: string) => string;
	renderIcon?: (item: NavItem) => React.ReactNode;
}) {
	const isActive = estItemActif(pathname, item);
	const activeDomaine = domaineDeLaRoute(pathname);

	// Détection si l'élément correspond à l'univers actif courant
	const isUniversePillar =
		depth === 0 &&
		((item.path === "#actualite" && activeDomaine === "association") ||
			(item.path === "#association" && activeDomaine === "association") ||
			(item.path === "#wiki" && activeDomaine === "wiki") ||
			(item.path === "#esport" && activeDomaine === "esport"));

	const [isOpen, setIsOpen] = React.useState(
		isActive || isUniversePillar || Boolean(item.defaultOpen)
	);

	React.useEffect(() => {
		// Un changement d'univers ouvre sa catégorie et replie celle que l'on
		// quitte. Les sous-sections internes conservent, elles, le choix manuel.
		if (depth === 0 && item.groupOnly) {
			setIsOpen(isUniversePillar);
			return;
		}
		if (isActive) {
			setIsOpen(true);
		}
	}, [depth, isActive, isUniversePillar, item.groupOnly]);

	const { state, isMobile } = useSidebar();
	const isCollapsed = state === "collapsed" && !isMobile;

	const buttonClass = `relative overflow-hidden w-full transition-all duration-200 group rounded-xl focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 outline-hidden ${
		isCollapsed && depth === 0
			? "h-[56px] flex-col justify-center px-1 gap-1 group-data-[collapsible=icon]:size-auto! group-data-[collapsible=icon]:h-14! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:p-1!"
			: "h-11 px-4 gap-3 justify-start"
	} ${
		isActive
			? "bg-sidebar-primary text-sidebar-primary-foreground font-bold"
			: "text-sidebar-foreground/85 hover:text-sidebar-foreground hover:bg-sidebar-accent active:bg-sidebar-accent"
	}`;

	const iconClass = `flex items-center justify-center transition-transform duration-200 ${
		isCollapsed && depth === 0 ? "size-6" : "size-5"
	} ${isActive && !item.imageUrl && !item.commonSprite ? "scale-110" : ""} group-hover:scale-110`;

	const itemContent = (
		<>
			<div className={iconClass}>
				<NavIcon
					item={item}
					isActive={Boolean(isActive)}
					isCollapsed={isCollapsed}
					depth={depth}
					t={t}
					renderIcon={renderIcon}
				/>
			</div>

			{(!isCollapsed || depth > 0) && (
				<span
					className={`whitespace-nowrap transition-all duration-300 font-medium truncate flex-1 text-sm ${
						isActive ? "font-bold" : ""
					}`}
				>
					{traduireNav(item.label, t)}
				</span>
			)}

			{item.children && (!isCollapsed || depth > 0) && (
				<ChevronRight
					size={18}
					className={`ml-auto text-sidebar-foreground/75 transition-transform duration-200 ${
						isOpen ? "rotate-90" : ""
					}`}
					aria-hidden="true"
				/>
			)}
		</>
	);

	if (item.children && !isCollapsed) {
		const isPillar = depth === 0 && item.groupOnly;
		const pillarColor =
			item.path === "#association"
				? "text-sidebar-foreground"
				: item.path === "#esport"
					? "text-sidebar-foreground"
					: "text-sidebar-foreground";

		const pillarBg =
			item.path === "#association"
				? "bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-border"
				: item.path === "#esport"
					? "bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-border"
					: "bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-border";

		return (
			<Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
				<SidebarMenuItem>
					{item.groupOnly ? (
						<CollapsibleTrigger asChild>
							<SidebarMenuButton
								isActive={isActive}
								tooltip={traduireNav(item.label, t)}
								className={
									isPillar
										? `relative overflow-hidden w-full transition-all duration-200 group rounded-xl px-3 py-2.5 h-auto flex items-center justify-between mt-3 mb-1 first:mt-0 font-extrabold text-xs tracking-wider uppercase border outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
												isActive || isUniversePillar
													? `${pillarBg} font-black shadow-xs`
											: "border-sidebar-border text-sidebar-foreground/85 font-bold bg-sidebar-accent/40 hover:bg-sidebar-accent hover:text-sidebar-foreground"
											}`
										: `${buttonClass} w-full`
								}
								aria-expanded={isOpen}
							>
								<div
									className={
										isPillar ? `flex items-center justify-center size-5 ${pillarColor}` : iconClass
									}
								>
									<NavIcon
										item={item}
										isActive={Boolean(isActive)}
										isCollapsed={isCollapsed}
										depth={depth}
										t={t}
										renderIcon={renderIcon}
									/>
								</div>
								<span
									className={`whitespace-nowrap transition-all duration-300 truncate flex-1 text-left ${
										isPillar ? "font-extrabold text-xs tracking-wider" : "text-sm font-medium"
									} ${isActive || isUniversePillar ? "font-black" : ""}`}
								>
									{traduireNav(item.label, t)}
								</span>
								<ChevronRight
									size={16}
									className={`shrink-0 text-sidebar-foreground/75 transition-transform duration-200 ${
										isOpen ? "rotate-90" : ""
									}`}
									aria-hidden="true"
								/>
							</SidebarMenuButton>
						</CollapsibleTrigger>
					) : (
						<div className="flex items-center w-full">
							<SidebarMenuButton
								asChild
								isActive={isActive}
								tooltip={traduireNav(item.label, t)}
								className={`${buttonClass} flex-1 min-w-0 !pr-0`}
							>
								<Link href={item.path} aria-current={isActive ? "page" : undefined}>
									<div className={iconClass}>
										<NavIcon
											item={item}
											isActive={Boolean(isActive)}
											isCollapsed={isCollapsed}
											depth={depth}
											t={t}
											renderIcon={renderIcon}
										/>
									</div>
									<span
										className={`whitespace-nowrap transition-all duration-300 font-medium truncate flex-1 text-sm ${
											isActive ? "font-bold" : ""
										}`}
									>
										{traduireNav(item.label, t)}
									</span>
								</Link>
							</SidebarMenuButton>
							<CollapsibleTrigger asChild>
								<button
									className="size-9 flex items-center justify-center rounded-lg text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors shrink-0"
									aria-label={`${isOpen ? "Réduire" : "Développer"} ${traduireNav(item.label, t)}`}
								>
									<ChevronRight
										size={18}
										className={`transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
										aria-hidden="true"
									/>
								</button>
							</CollapsibleTrigger>
						</div>
					)}
					<CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
						<SidebarMenu className="mt-1 ml-4 border-l-2 border-sidebar-border pl-2 space-y-1">
							{item.children.map((child) => (
								<RecursiveNavItem
									key={child.path}
									item={child}
									pathname={pathname}
									depth={depth + 1}
									t={t}
									renderIcon={renderIcon}
								/>
							))}
						</SidebarMenu>
					</CollapsibleContent>
				</SidebarMenuItem>
			</Collapsible>
		);
	}

	const href = item.groupOnly ? (item.children?.[0]?.path ?? item.path) : item.path;

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				asChild
				isActive={isActive}
				tooltip={traduireNav(item.label, t)}
				className={buttonClass}
			>
				<Link href={href} aria-current={isActive ? "page" : undefined}>
					{itemContent}
				</Link>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

export function AppSidebar({
	items,
	isAdmin = false,
	canView,
	t,
	renderIcon,
	headerSlot,
	footerSlot,
	className,
	...props
}: AppSidebarProps) {
	const pathname = usePathname() || "/";
	const resolvedNavItems = items ?? itemsDeNavigation();
	const { state, isMobile } = useSidebar();
	const isCollapsed = state === "collapsed" && !isMobile;

	const [mounted, setMounted] = React.useState(false);
	React.useEffect(() => {
		setMounted(true);
	}, []);

	const filteredNavItems = filtrerNavigation(resolvedNavItems, (item) => {
		if (item.adminOnly && !(mounted && isAdmin)) return false;
		return canView?.(item) ?? true;
	});

	const defaultHeader = <SidebarUniverseHeader pathname={pathname} isCollapsed={isCollapsed} />;

	return (
		<Sidebar
			collapsible="icon"
			variant="sidebar"
			className={`border-none bg-sidebar text-sidebar-foreground ${className ?? ""}`}
			{...props}
		>
			<div className="absolute inset-0 bg-sidebar -z-10" />

			{headerSlot === undefined ? defaultHeader : headerSlot}

			<SidebarContent className="py-2 bg-sidebar text-sidebar-foreground">
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu className="gap-1">
							{filteredNavItems.map((item) => (
								<div key={item.path} className="w-full">
									<RecursiveNavItem item={item} pathname={pathname} t={t} renderIcon={renderIcon} />
								</div>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			{footerSlot}

			<SidebarRail />
		</Sidebar>
	);
}

export { AppSidebar as WikiSidebar };
export default AppSidebar;
