/**
 * KiAura — Super Saiyan & Ki Energy Aura Effect in Pure SVG.
 * Features radiating energy flares, crackling lightning sparks, and comic speedlines.
 */

import { useId, type SVGProps } from "react";
import { radialSpeedlines } from "../toriyama-svg";

export interface KiAuraProps extends Omit<SVGProps<SVGSVGElement>, "size"> {
	size?: number | string;
	color?: "gold" | "blue" | "red" | "green" | "purple";
	sparks?: boolean;
	title?: string;
	decorative?: boolean;
}

const AURA_COLORS = {
	gold: { core: "#ffffff", flare: "#ffd700", outer: "#ff9e00", spark: "#00f0ff" },
	blue: { core: "#ffffff", flare: "#00f0ff", outer: "#0077b6", spark: "#fee440" },
	red: { core: "#ffffff", flare: "#ff0054", outer: "#9d0208", spark: "#ffe600" },
	green: { core: "#ffffff", flare: "#70e000", outer: "#38b000", spark: "#ffffff" },
	purple: { core: "#ffffff", flare: "#f72585", outer: "#7209b7", spark: "#4cc9f0" },
};

export function KiAura({
	size = 120,
	color = "gold",
	sparks = true,
	className = "",
	title,
	decorative = true,
	...props
}: KiAuraProps) {
	const c = AURA_COLORS[color] ?? AURA_COLORS.gold;
	const a11y = decorative
		? { "aria-hidden": true as const }
		: { role: "img" as const, "aria-label": title ?? `Ki Aura (${color})` };

	const id = useId().replace(/:/g, "");
	const gradId = `aura-grad-${id}`;
	const speedlines = radialSpeedlines(50, 50, 24, 46, 20);

	return (
		<svg
			viewBox="0 0 100 100"
			width={size}
			height={size}
			className={`inline-block select-none overflow-visible ${className}`}
			{...a11y}
			{...props}
		>
			<defs>
				<radialGradient id={gradId} cx="50%" cy="50%" r="50%">
					<stop offset="0%" stopColor={c.core} stopOpacity="0.95" />
					<stop offset="45%" stopColor={c.flare} stopOpacity="0.7" />
					<stop offset="85%" stopColor={c.outer} stopOpacity="0.2" />
					<stop offset="100%" stopColor={c.outer} stopOpacity="0" />
				</radialGradient>
			</defs>

			{/* Soft glowing aura orb */}
			<circle cx="50" cy="50" r="46" fill={`url(#${gradId})`} />

			{/* Radiating sharp action speedlines */}
			{speedlines.map((line, idx) => (
				<path
					key={idx}
					d={line}
					stroke={c.flare}
					strokeWidth={idx % 2 === 0 ? 1.5 : 0.8}
					strokeLinecap="round"
					opacity={0.8}
				/>
			))}

			{/* Crackling lightning sparks */}
			{sparks && (
				<g stroke={c.spark} strokeWidth="1.6" strokeLinecap="square" fill="none" opacity="0.9">
					<path d="M 40 28 L 44 36 L 40 40 L 46 48" />
					<path d="M 64 55 L 58 64 L 63 68 L 57 76" />
					<path d="M 28 58 L 34 62 L 31 69" />
					<path d="M 66 32 L 60 38 L 65 44" />
				</g>
			)}
		</svg>
	);
}