import { Card, CardContent } from "@rosegriffon/ui";
import { FileText, Palette, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

interface QuickLink {
	title: string;
	description: string;
	href: string;
	icon: LucideIcon;
	accent: string;
}

const QUICK_LINKS: QuickLink[] = [
	{
		accent: "text-sky-500",
		description: "Avatar, bio, réseaux sociaux",
		href: "/settings",
		icon: Settings,
		title: "Mon Compte",
	},
	{
		accent: "text-violet-500",
		description: "Générateur de PFP officielle",
		href: "/projets/outils/pfp",
		icon: Palette,
		title: "Avatar RG",
	},
	{
		accent: "text-emerald-500",
		description: "Brouillons et publications",
		href: "/dashboard/articles",
		icon: FileText,
		title: "Mes Articles",
	},
];

export function ProfileQuickLinks() {
	return (
		<section aria-labelledby="quick-links-title">
			<h2 id="quick-links-title" className="mb-4 text-xl font-semibold text-foreground">
				Mon espace
			</h2>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{QUICK_LINKS.map(({ href, title, description, icon: Icon, accent }) => (
					<Link key={href} href={href} className="group">
						<Card className="h-full transition-all group-hover:border-primary/40 group-hover:-translate-y-0.5 group-hover:shadow-md">
							<CardContent className="flex items-start gap-3 p-5">
								<div className={`mt-1 ${accent}`} aria-hidden="true">
									<Icon className="size-5" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="font-semibold text-foreground">{title}</p>
									<p className="mt-1 text-xs text-muted-foreground">{description}</p>
								</div>
							</CardContent>
						</Card>
					</Link>
				))}
			</div>
		</section>
	);
}
