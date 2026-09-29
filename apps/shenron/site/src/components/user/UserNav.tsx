"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CapsuleCorp, Coeur, Kame, Reglages, Tendance } from "@/components/icones";

const ITEMS = [
	{ href: "/dashboard", label: "Vue d’ensemble", icon: CapsuleCorp },
	{ href: "/profil/me", label: "Profil public", icon: Kame },
	{ href: "/favoris", label: "Favoris", icon: Coeur },
	{ href: "/tierlists/mes", label: "Mes tier lists", icon: Tendance },
	{ href: "/parametres", label: "Paramètres", icon: Reglages },
] as const;

export function UserNav() {
	const pathname = usePathname();
	return (
		<nav
			aria-label="Espace membre"
			className="mb-8 overflow-x-auto rounded-2xl border border-white/10 bg-black/25 p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			<ul className="flex min-w-max gap-1">
				{ITEMS.map(({ href, label, icon: Icon }) => {
					const active =
						href === "/profil/me" ? pathname.startsWith("/profil/") : pathname === href;
					return (
						<li key={href}>
							<Link
								href={href}
								aria-current={active ? "page" : undefined}
								className={`flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-dbz-orange ${active ? "bg-dbz-orange text-black" : "text-white/60 hover:bg-white/[.07] hover:text-white"}`}
							>
								<Icon className="h-4 w-4" aria-hidden />
								{label}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
