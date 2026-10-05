"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WIKI_NAVIGATION_MANIFEST, type WikiNavItem } from "@/lib/wiki-nav-manifest";
import { ChevronDown, Compass, X, BookOpen } from "lucide-react";

export function WikiDrawer({ className = "" }: { className?: string }) {
	const [isOpen, setIsOpen] = useState(false);
	const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
		// Ouvrir Manga, Databooks et Événements par défaut
		return { manga: true, databooks: true, events: true };
	});
	const pathname = usePathname();

	// Fermer le drawer lors d'une navigation
	useEffect(() => {
		setIsOpen(false);
	}, [pathname]);

	// Fermer avec la touche Échap
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isOpen) {
				setIsOpen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen]);

	const toggleGroup = useCallback((groupId: string) => {
		setOpenGroups((prev) => ({
			...prev,
			[groupId]: !prev[groupId],
		}));
	}, []);

	return (
		<div className={`relative ${className}`}>
			{/* Bouton déclencheur discret et élégant */}
			<button
				type="button"
				onClick={() => setIsOpen(true)}
				className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-black/60 px-3.5 py-2 text-xs font-semibold text-amber-300 shadow-lg shadow-black/40 backdrop-blur-md transition-all hover:border-amber-400 hover:bg-amber-950/30 hover:text-white active:scale-95"
				aria-haspopup="dialog"
				aria-expanded={isOpen}
			>
				<Compass className="h-4 w-4 animate-spin-slow text-amber-400" />
				<span>Explorer le Wiki</span>
				<span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
					6 Portails
				</span>
			</button>

			{/* Overlay Backdrop */}
			{isOpen && (
				<div
					className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm transition-opacity animate-in fade-in"
					onClick={() => setIsOpen(false)}
					aria-hidden="true"
				/>
			)}

			{/* Panneau Drawer Coulissant */}
			{isOpen && (
				<aside
					className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-white/10 bg-gradient-to-b from-neutral-950 via-neutral-900 to-black p-6 shadow-2xl shadow-black/80 animate-in slide-in-from-right duration-200 sm:w-[420px]"
					role="dialog"
					aria-modal="true"
					aria-label="Navigation universelle Dragon Ball"
				>
					{/* Header du Drawer */}
					<div className="flex items-center justify-between border-b border-white/10 pb-4">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-xl shadow-inner">
								🐉
							</div>
							<div>
								<h2 className="text-sm font-bold text-white tracking-wide">Encyclopédie Dragon Ball</h2>
								<p className="text-[11px] text-amber-300/80">Architecture canonique DBFR</p>
							</div>
						</div>
						<button
							type="button"
							onClick={() => setIsOpen(false)}
							className="rounded-lg border border-white/10 p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
							aria-label="Fermer le panneau"
						>
							<X className="h-4 w-4" />
						</button>
					</div>

					{/* Contenu Scrollable des Groupes Accordéon */}
					<div className="flex-1 overflow-y-auto pr-1 py-4 space-y-3">
						{WIKI_NAVIGATION_MANIFEST.map((group) => {
							const isExpanded = Boolean(openGroups[group.id]);
							return (
								<div
									key={group.id}
									className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden transition-all duration-200 hover:border-white/15"
								>
									<button
										type="button"
										onClick={() => toggleGroup(group.id)}
										className="flex w-full items-center justify-between p-3.5 text-left transition hover:bg-white/[0.04]"
										aria-expanded={isExpanded}
									>
										<div className="flex items-center gap-3 min-w-0">
											<span className="text-xl">{group.icon}</span>
											<div className="truncate">
												<div className="text-xs font-bold text-white tracking-wide">
													{group.title}
												</div>
												<div className="text-[10px] text-white/40 truncate">
													{group.summary}
												</div>
											</div>
										</div>
										<ChevronDown
											className={`h-4 w-4 text-white/40 transition-transform duration-200 shrink-0 ${
												isExpanded ? "rotate-180 text-amber-400" : ""
											}`}
										/>
									</button>

									{isExpanded && (
										<div className="divide-y divide-white/5 border-t border-white/5 bg-black/40 px-2 py-1">
											{group.items.map((item) => {
												const isActive = pathname === item.href;
												return (
													<Link
														key={item.id}
														href={item.href}
														className={`group flex items-start gap-3 rounded-xl p-2.5 transition-all ${
															isActive
																? "bg-amber-500/15 border border-amber-500/30 text-amber-200"
																: "hover:bg-white/[0.06] text-white/80 hover:text-white"
														}`}
													>
														<span className="text-base pt-0.5">{item.icon ?? "🔹"}</span>
														<div className="flex-1 min-w-0">
															<div className="flex items-center gap-2">
																<span className="text-xs font-semibold truncate">
																	{item.label}
																</span>
																{item.badge && (
																	<span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.2 text-[9px] font-bold text-amber-300">
																		{item.badge}
																	</span>
																)}
															</div>
															<p className="text-[11px] text-white/40 group-hover:text-white/60 transition-colors line-clamp-1">
																{item.description}
															</p>
														</div>
													</Link>
												);
											})}
										</div>
									)}
								</div>
							);
						})}
					</div>

					{/* Footer Doctrine & Status */}
					<div className="border-t border-white/10 pt-3 text-center">
						<div className="flex items-center justify-between text-[11px] text-white/40">
							<span className="flex items-center gap-1.5">
								<span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
								Base Vivante
							</span>
							<Link
								href="/wiki/canon"
								className="text-amber-400 hover:text-amber-300 transition-colors font-medium"
							>
								Doctrine Canonique →
							</Link>
						</div>
					</div>
				</aside>
			)}
		</div>
	);
}
