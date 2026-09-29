"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { SignInDiscord } from "@/components/SignInDiscord";
import { SignOut } from "@/components/SignOut";
import { Rouage, Curseurs, DragonBall } from "@/components/icones";
import { useMe } from "@/lib/use-me";
import { useLangue } from "@/lib/i18n/client";

/**
 * Zone identité de la barre du haut (îlot client). Hydrate l'état d'auth via
 * `/api/me` côté client → le layout + les pages restent statiques/ISR cacheables.
 *
 * `variant="compact"` : sur mobile, la barre du haut ne porte plus que la
 * recherche et le compte — la navigation est descendue dans la barre basse. Il
 * n'y reste donc que l'AVATAR : le pseudo n'y tiendrait pas sous 360 px, et le
 * bouton de déconnexion vit désormais dans la feuille « Plus », pas dans une
 * barre où il jouxterait le lien du profil au pixel près.
 */
export function NavAuth({ variant = "full" }: { variant?: "full" | "compact" }) {
	const me = useMe();
	const { dico } = useLangue();
	const compact = variant === "compact";

	// Placeholder de même gabarit tant que /api/me n'a pas répondu (anti-CLS).
	if (me === undefined) {
		return <div className={compact ? "h-11 w-11" : "h-9 w-[120px]"} aria-hidden />;
	}

	if (compact) {
		// 44 px de cible : au-dessus des 24 px exigés par WCAG 2.2 (2.5.8, AA),
		// sous les 48 dp de Material 3 — c'est la taille des autres commandes de
		// cette barre, et l'uniformité prime ici sur les 4 px manquants.
		return me.authenticated ? (
			<Link
				href="/dashboard"
				aria-label={me.username ? `${dico.common.mySpace} — ${me.username}` : dico.common.mySpace}
				className="grid h-11 w-11 place-items-center rounded-full transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-[var(--color-logo-jaune)]"
			>
				<Avatar src={me.avatar} size={28} className="ring-1 ring-white/15" />
			</Link>
		) : (
			<SignInDiscord
				aria-label={dico.common.signInDiscord}
				className="grid h-11 w-11 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-[var(--color-logo-jaune)]"
			>
				<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
					<path d="M12 2.6a5.2 5.2 0 0 0-5.2 5.2A5.2 5.2 0 0 0 12 13a5.2 5.2 0 0 0 5.2-5.2A5.2 5.2 0 0 0 12 2.6Zm0 12.2c-4.3 0-8 2.2-8 5v1.6h16v-1.6c0-2.8-3.7-5-8-5Z" />
				</svg>
			</SignInDiscord>
		);
	}

	return (
		<div className="flex items-center gap-1.5 sm:gap-2">
			{me.isAdmin && (
				<Link
					href="/admin/dashboard"
					title={`${dico.nav.admin} (Staff)`}
					aria-label={dico.nav.admin}
					className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--color-toriyama-orange,#f85b1a)]/15 hover:bg-[var(--color-toriyama-orange,#f85b1a)] text-[var(--color-toriyama-orange,#f85b1a)] hover:text-black border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[2px_2px_0px_var(--color-toriyama-ink,#121417)] transition-all hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange"
				>
					<Rouage size={18} className="shrink-0" />
				</Link>
			)}
			{me.authenticated ? (
				<>
					<Link
						href="/dashboard"
						title={me.username ? `${dico.common.profile} — ${me.username}` : dico.common.mySpace}
						aria-label={me.username ? `${dico.common.profile} — ${me.username}` : dico.common.profile}
						className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] hover:bg-white/[0.12] border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[2px_2px_0px_var(--color-toriyama-ink,#121417)] transition-all hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange group"
					>
						<Avatar
							src={me.avatar}
							size={26}
							className="rounded-lg transition group-hover:ring-2 group-hover:ring-[var(--color-toriyama-orange,#f85b1a)]"
						/>
					</Link>
					<Link
						href="/parametres"
						title={dico.common.settings}
						aria-label={dico.common.settings}
						className="hidden xl:grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] hover:bg-white/[0.12] border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[2px_2px_0px_var(--color-toriyama-ink,#121417)] text-white/70 hover:text-[var(--color-toriyama-orange)] transition-all hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange"
					>
						<Curseurs size={18} />
					</Link>
					<SignOut
						className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] hover:bg-red-500/20 text-white/70 hover:text-red-400 border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[2px_2px_0px_var(--color-toriyama-ink,#121417)] transition-all hover:scale-105 active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange"
						aria-label={dico.common.signOut}
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
							<polyline points="16 17 21 12 16 7" />
							<line x1="21" y1="12" x2="9" y2="12" />
						</svg>
					</SignOut>
				</>
			) : (
				<SignInDiscord
					aria-label={dico.common.signIn}
					className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[var(--color-toriyama-orange,#f85b1a)] hover:bg-white text-black font-display font-bold text-[13px] uppercase tracking-wider border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[2px_2px_0px_var(--color-toriyama-ink,#121417)] transition-all hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange"
				>
					<DragonBall size={16} />
					<span className="hidden sm:inline">{dico.common.signIn}</span>
				</SignInDiscord>
			)}
		</div>
	);
}
