"use client";

/**
 * Primitives FX Dragon Ball partagées par les mini-jeux du site.
 * Réutilise les classes globales (dbz-panel, scouter-text, speed-lines…) et
 * ajoute les effets propres au jeu via games.module.css (aura, onde de choc,
 * flash, tremblement, charge de power level). Aucun style global redéfini.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./games.module.css";

type AuraColor = "orange" | "yellow" | "blue" | "red" | "green" | "purple";

const AURA_RGBA: Record<AuraColor, string> = {
	orange: "rgba(255, 178, 0, 0.55)",
	yellow: "color-mix(in srgb, var(--color-dbz-amber) 60%, transparent)",
	blue: "color-mix(in srgb, var(--color-dbz-ki) 55%, transparent)",
	red: "rgba(255, 60, 60, 0.55)",
	green: "rgba(74, 222, 128, 0.5)",
	purple: "rgba(192, 132, 252, 0.5)",
};

const FLASH_RGBA: Record<AuraColor, string> = {
	orange: "rgba(255, 178, 0, 0.85)",
	yellow: "rgba(255, 240, 180, 0.9)",
	blue: "rgba(120, 190, 255, 0.85)",
	red: "rgba(255, 80, 80, 0.85)",
	green: "rgba(150, 255, 180, 0.85)",
	purple: "rgba(210, 160, 255, 0.85)",
};

/** Aura de Ki pulsée autour d'un élément (boutons, tuiles, cellules actives). */
export function KiAura({
	color = "orange",
	strong = false,
	className = "",
	style,
	children,
}: {
	color?: AuraColor;
	strong?: boolean;
	className?: string;
	style?: CSSProperties;
	children: ReactNode;
}) {
	return (
		<div
			className={`${styles.aura} ${strong ? styles.auraStrong : ""} ${className}`}
			style={{ "--aura": AURA_RGBA[color], ...style } as CSSProperties}
		>
			{children}
		</div>
	);
}

/** Onde de choc + flash déclenchés par changement de `trigger` (clé unique). */
export function KiShock({
	trigger,
	color = "yellow",
	flash = false,
}: {
	trigger: number | string | null;
	color?: AuraColor;
	flash?: boolean;
}) {
	if (trigger === null) return null;
	return (
		<>
			<span
				key={`shock-${trigger}`}
				className={styles.shockwave}
				style={{ "--shock": AURA_RGBA[color] } as CSSProperties}
				aria-hidden
			/>
			{flash && (
				<span
					key={`flash-${trigger}`}
					className={styles.flash}
					style={{ "--flash": FLASH_RGBA[color] } as CSSProperties}
					aria-hidden
				/>
			)}
		</>
	);
}

/**
 * Compteur "power level" type scouter : anime un comptage rapide vers `value`
 * et déclenche un pop de charge à chaque hausse.
 */
export function PowerLevel({
	value,
	label = "Power level",
	className = "",
}: {
	value: number;
	label?: string;
	className?: string;
}) {
	const [display, setDisplay] = useState(value);
	const [charging, setCharging] = useState(false);
	const prev = useRef(value);
	const raf = useRef<number | null>(null);

	useEffect(() => {
		const from = prev.current;
		const to = value;
		prev.current = value;
		if (from === to) {
			setDisplay(to);
			return;
		}
		setCharging(true);
		const start = performance.now();
		const dur = 420;
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / dur);
			// easeOutCubic
			const eased = 1 - (1 - t) ** 3;
			setDisplay(Math.round(from + (to - from) * eased));
			if (t < 1) {
				raf.current = requestAnimationFrame(tick);
			} else {
				setDisplay(to);
				setCharging(false);
			}
		};
		raf.current = requestAnimationFrame(tick);
		return () => {
			if (raf.current) cancelAnimationFrame(raf.current);
		};
	}, [value]);

	return (
		<div className={`hud-frame px-4 py-2 text-center ${className}`}>
			<p className="font-scouter text-[9px] tracking-[0.3em] text-dbz-orange uppercase mb-0.5">
				{label}
			</p>
			<p
				className={`scouter-text text-2xl leading-none tabular-nums ${charging ? styles.charge : ""}`}
			>
				{display.toLocaleString("fr-FR")}
			</p>
		</div>
	);
}

/** Anneau réacteur de Ki (capteur). Décor pur. */
export function KiReactor({
	color = "orange",
	active = false,
	className = "",
}: {
	color?: AuraColor;
	active?: boolean;
	className?: string;
}) {
	return (
		<div className={`relative grid place-items-center ${className}`} aria-hidden>
			<div
				className={`absolute inset-0 rounded-full speed-lines ${active ? styles.kiSpin : ""}`}
				style={{ opacity: active ? 0.8 : 0.35 }}
			/>
			<KiAura color={color} strong={active}>
				<div
					className="rounded-full border-2"
					style={{
						width: "1.5rem",
						height: "1.5rem",
						borderColor: AURA_RGBA[color].replace("0.5", "0.9"),
						background: `radial-gradient(circle, ${AURA_RGBA[color]}, transparent 70%)`,
					}}
				/>
			</KiAura>
		</div>
	);
}

;
