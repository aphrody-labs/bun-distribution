"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	construireMobileNavUnifiee,
	estRouteActive,
	type NavItem,
} from "../config/navigation";
import { iconMap } from "../lib/icons";
import { traduireNav } from "../lib/translations";

function safeHaptic() {
	if (typeof window !== "undefined" && "navigator" in window && "vibrate" in navigator) {
		try {
			navigator.vibrate(10);
		} catch {
			// Ignore vibration errors
		}
	}
}

export interface MobileBottomNavProps {
	items?: (NavItem & { isAction?: boolean })[];
	t?: (key: string) => string;
	renderIcon?: (item: NavItem) => React.ReactNode;
	className?: string;
}

function NavItemButton({
	item,
	isActive,
	t,
	renderIcon,
}: {
	item: NavItem;
	isActive: boolean;
	t?: (key: string) => string;
	renderIcon?: (item: NavItem) => React.ReactNode;
}) {
	const LucideIcon = iconMap[item.icon];
	const customIcon = renderIcon ? renderIcon(item) : null;

	return (
		<Link
			href={item.path}
			aria-current={isActive ? "page" : undefined}
			onClick={(e: MouseEvent<HTMLAnchorElement>) => {
				if (isActive) {
					e.preventDefault();
					if (typeof window !== "undefined") {
						window.scrollTo({ behavior: "smooth", top: 0 });
					}
					safeHaptic();
				} else {
					safeHaptic();
				}
			}}
			className="relative flex flex-col items-center justify-center gap-1 flex-1 h-full min-w-0 cursor-pointer select-none"
		>
			{/* Active pill */}
			<div
				className={`absolute inset-0 m-auto w-16 h-8 rounded-full bg-secondary-container transition-all duration-300 motion-emphasized-decelerate ${
					isActive ? "opacity-100 scale-100" : "opacity-0 scale-50"
				}`}
			/>

			{/* Icon */}
			{customIcon ??
				(LucideIcon && (
					<LucideIcon
						size={24}
						className={`relative z-10 transition-colors duration-200 ${
					isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/80"
						}`}
						fill={isActive ? "currentColor" : "none"}
						aria-hidden="true"
					/>
				))}

			{/* Label */}
			<span
				className={`relative z-10 type-label-medium text-center w-full truncate transition-colors duration-200 ${
					isActive ? "text-sidebar-foreground" : "text-sidebar-foreground/80"
				}`}
			>
				{traduireNav(item.label, t)}
			</span>
		</Link>
	);
}

function FABActionButton({
	item,
	t,
	renderIcon,
}: {
	item: NavItem;
	t?: (key: string) => string;
	renderIcon?: (item: NavItem) => React.ReactNode;
}) {
	const LucideIcon = iconMap[item.icon];
	const customIcon = renderIcon ? renderIcon(item) : null;

	return (
		<Link
			href={item.path}
			onClick={() => safeHaptic()}
			className="relative flex items-center justify-center -mt-5 size-14 rounded-full bg-primary text-on-primary shadow-lg transition-all duration-200 motion-standard hover:shadow-xl hover:scale-105 active:scale-95 active:shadow-md z-20"
		>
			{customIcon ??
				(LucideIcon && (
					<LucideIcon size={28} className="relative z-10" fill="currentColor" aria-hidden="true" />
				))}
			<span className="sr-only">{traduireNav(item.label, t)}</span>
		</Link>
	);
}

export function MobileBottomNav({
	items,
	t,
	renderIcon,
	className,
}: MobileBottomNavProps = {}) {
	const pathname = usePathname() || "/";
	// L'administration a sa propre barre latérale : la barre du bas portait une
	// liste d'actions `/admin/**` qu'aucun écran ne rendait (le chrome est masqué
	// sous `/admin`).
	const resolvedItems = items ?? construireMobileNavUnifiee();

	return (
		<nav
			aria-label="Navigation mobile"
			className={`fixed bottom-0 left-0 right-0 z-50 h-[calc(5rem+env(safe-area-inset-bottom))] pb-safe bg-sidebar/95 text-sidebar-foreground backdrop-blur-xl border-t border-sidebar-border md:hidden ${
				className ?? ""
			}`}
		>
			<div className="flex items-center justify-around h-full px-2">
				{resolvedItems.map((item) => {
					const activePaths = "activePaths" in item ? item.activePaths : undefined;
					const isActive = activePaths
						? activePaths.some((p) => estRouteActive(pathname, p))
						: estRouteActive(pathname, item.path);

					if ("isAction" in item && item.isAction) {
						return (
							<FABActionButton
								key={item.path}
								item={item}
								t={t}
								renderIcon={renderIcon}
							/>
						);
					}

					return (
						<NavItemButton
							key={item.path}
							item={item}
							isActive={isActive}
							t={t}
							renderIcon={renderIcon}
						/>
					);
				})}
			</div>
		</nav>
	);
}

export { MobileBottomNav as MaterialBottomNav };
export { MobileBottomNav as MobileBottomNavigation };
export default MobileBottomNav;
