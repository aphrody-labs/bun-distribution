/**
 * DragonRadarDisplay — Bulma's Official Dragon Radar in Pure SVG.
 * Features CRT scanline grid, concentric distance rings, blinking target blips, and direction arrow.
 */

import { useId, type SVGProps } from "react";

export interface DragonRadarDisplayProps extends Omit<SVGProps<SVGSVGElement>, "size"> {
	size?: number | string;
	blips?: { x: number; y: number }[];
	scanning?: boolean;
	title?: string;
	decorative?: boolean;
}

export function DragonRadarDisplay({
	size = 80,
	blips = [
		{ x: 38, y: 32 },
		{ x: 62, y: 44 },
		{ x: 50, y: 68 },
	],
	scanning = true,
	className = "",
	title,
	decorative = false,
	...props
}: DragonRadarDisplayProps) {
	const a11y = decorative
		? { "aria-hidden": true as const }
		: { role: "img" as const, "aria-label": title ?? "Dragon Radar (Détecteur de Dragon Balls)" };

	const id = useId().replace(/:/g, "");
	const clipId = `radar-clip-${id}`;

	return (
		<svg
			viewBox="0 0 100 110"
			width={size}
			height={typeof size === "number" ? (size * 110) / 100 : size}
			className={`inline-block shrink-0 select-none ${className}`}
			style={{ filter: "drop-shadow(3px 4px 0px #121417)" }}
			{...a11y}
			{...props}
		>
			<defs>
				<clipPath id={clipId}>
					<circle cx="50" cy="60" r="38" />
				</clipPath>
			</defs>

			{/* Top Push Button */}
			<rect x="44" y="2" width="12" height="12" rx="2" fill="#e0e1dd" stroke="#121417" strokeWidth="2.5" />
			<rect x="46" y="5" width="8" height="3" fill="#ff0054" />

			{/* Outer Hull Bezel */}
			<circle cx="50" cy="60" r="48" fill="#2ec4b6" stroke="#121417" strokeWidth="4" />
			{/* Inner Bezel Groove */}
			<circle cx="50" cy="60" r="41" fill="#121417" />

			{/* CRT Screen Display */}
			<circle cx="50" cy="60" r="38" fill="#0b2528" />

			{/* Grid & Reticles (Clipped) */}
			<g clipPath={`url(#${clipId})`}>
				{/* Concentric rings */}
				<circle cx="50" cy="60" r="12" fill="none" stroke="#00f5d4" strokeWidth="1.2" opacity="0.6" />
				<circle cx="50" cy="60" r="24" fill="none" stroke="#00f5d4" strokeWidth="1.2" opacity="0.6" />
				<circle cx="50" cy="60" r="36" fill="none" stroke="#00f5d4" strokeWidth="1.2" opacity="0.6" />

				{/* Crosshair axes */}
				<line x1="12" y1="60" x2="88" y2="60" stroke="#00f5d4" strokeWidth="1.2" opacity="0.6" />
				<line x1="50" y1="22" x2="50" y2="98" stroke="#00f5d4" strokeWidth="1.2" opacity="0.6" />

				{/* Diagonal tick markers */}
				<line x1="23" y1="33" x2="77" y2="87" stroke="#00f5d4" strokeWidth="0.8" strokeDasharray="2 3" opacity="0.4" />
				<line x1="77" y1="33" x2="23" y2="87" stroke="#00f5d4" strokeWidth="0.8" strokeDasharray="2 3" opacity="0.4" />

				{/* Center User Triangle Indicator */}
				<polygon points="50,55 54,64 46,64" fill="#fee440" stroke="#121417" strokeWidth="1" />

				{/* Target Dragon Ball Blips */}
				{blips.map((b, i) => (
					<g key={i} className={scanning ? "animate-pulse" : undefined}>
						<circle cx={b.x} cy={b.y} r="3.2" fill="#fee440" stroke="#ff0054" strokeWidth="1.2" />
						<circle cx={b.x} cy={b.y} r="1.2" fill="#ffffff" />
					</g>
				))}
			</g>
		</svg>
	);
}