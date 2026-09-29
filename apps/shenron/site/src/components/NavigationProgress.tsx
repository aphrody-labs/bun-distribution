"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { KintoUnLoader } from "@/components/KintoUn";

type Status = "idle" | "loading" | "done";

/**
 * Barre de progression de navigation globale (or → rouge Dragon Ball).
 * Île client : ne lit aucune session/param serveur → cache CDN préservé.
 * Départ = clic gauche simple sur un <a> interne réel. Fin = changement de
 * usePathname() (jamais useSearchParams → pas de dé-opt statique).
 */
export function NavigationProgress() {
	const pathname = usePathname();
	const [status, setStatus] = useState<Status>("idle");
	const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mounted = useRef(false);

	function finish() {
		if (guardTimer.current) clearTimeout(guardTimer.current);
		setStatus((s) => (s === "loading" ? "done" : s));
		if (doneTimer.current) clearTimeout(doneTimer.current);
		doneTimer.current = setTimeout(() => setStatus("idle"), 260);
	}

	useEffect(() => {
		function start() {
			if (doneTimer.current) clearTimeout(doneTimer.current);
			if (guardTimer.current) clearTimeout(guardTimer.current);
			setStatus("loading");
			guardTimer.current = setTimeout(finish, 8000); // garde-fou anti-blocage
		}
		function onClick(e: MouseEvent) {
			if (e.defaultPrevented || e.button !== 0) return;
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			const a = (e.target as Element | null)?.closest?.("a") as HTMLAnchorElement | null;
			if (!a) return;
			const href = a.getAttribute("href");
			if (!href || href[0] === "#") return;
			if (a.target && a.target !== "_self") return;
			if (a.hasAttribute("download")) return;
			let url: URL;
			try {
				url = new URL(href, window.location.href);
			} catch {
				return;
			}
			if (url.origin !== window.location.origin) return;
			if (url.pathname === window.location.pathname && url.search === window.location.search)
				return;
			start();
		}
		document.addEventListener("click", onClick, true);
		return () => document.removeEventListener("click", onClick, true);
	}, []);

	useEffect(() => {
		if (!mounted.current) {
			mounted.current = true;
			return;
		} // ignore le mount
		finish();
	}, [pathname]);

	useEffect(
		() => () => {
			if (doneTimer.current) clearTimeout(doneTimer.current);
			if (guardTimer.current) clearTimeout(guardTimer.current);
		},
		[]
	);

	return (
		<div aria-hidden className="nav-progress" data-status={status}>
			<span className="nav-progress__bar" />
			{status === "loading" && (
				<span className="nav-progress__orb">
					<KintoUnLoader size={14} decorative />
				</span>
			)}
		</div>
	);
}
