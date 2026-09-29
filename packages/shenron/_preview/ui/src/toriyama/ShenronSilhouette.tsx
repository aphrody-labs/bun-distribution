/**
 * ShenronSilhouette — Divine Dragon Shenron Silhouette in Pure Vector SVG.
 * Features branching dragon antlers, sinuous body, flowing whiskers, and divine golden glow.
 */

import type { SVGProps } from "react";

export interface ShenronSilhouetteProps extends Omit<SVGProps<SVGSVGElement>, "size"> {
	size?: number | string;
	color?: string;
	title?: string;
	decorative?: boolean;
}

export function ShenronSilhouette({
	size = 80,
	color = "#2d6a4f",
	className = "",
	title,
	decorative = false,
	...props
}: ShenronSilhouetteProps) {
	const a11y = decorative
		? { "aria-hidden": true as const }
		: { role: "img" as const, "aria-label": title ?? "Shenron, le Dragon Sacré" };

	return (
		<svg
			viewBox="0 0 100 100"
			width={size}
			height={size}
			className={`inline-block select-none ${className}`}
			style={{ filter: "drop-shadow(2px 3px 0px #121417)" }}
			{...a11y}
			{...props}
		>
			{/* Dragon Antlers */}
			<path
				d="M 28 32 L 20 16 L 26 22 L 24 10 L 32 20 L 36 28"
				fill="none"
				stroke="#6f4e37"
				strokeWidth="3.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M 72 32 L 80 16 L 74 22 L 76 10 L 68 20 L 64 28"
				fill="none"
				stroke="#6f4e37"
				strokeWidth="3.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>

			{/* Sinuous Dragon Head & Jaws */}
			<path
				d="M 36 28 L 50 18 L 64 28 L 68 44 L 62 58 L 50 64 L 38 58 L 32 44 Z"
				fill={color}
				stroke="#121417"
				strokeWidth="3"
				strokeLinejoin="round"
			/>

			{/* Dragon Whiskers */}
			<path
				d="M 38 48 C 24 50 12 62 8 74"
				fill="none"
				stroke="#ffb703"
				strokeWidth="2"
				strokeLinecap="round"
			/>
			<path
				d="M 62 48 C 76 50 88 62 92 74"
				fill="none"
				stroke="#ffb703"
				strokeWidth="2"
				strokeLinecap="round"
			/>

			{/* Piercing Crimson Eyes */}
			<circle cx="43" cy="38" r="2.8" fill="#e63946" stroke="#121417" strokeWidth="1" />
			<circle cx="57" cy="38" r="2.8" fill="#e63946" stroke="#121417" strokeWidth="1" />

			{/* Snout and Teeth */}
			<path d="M 44 48 L 50 45 L 56 48" fill="none" stroke="#121417" strokeWidth="2" />
			<polygon points="46,54 50,50 54,54" fill="#ffffff" stroke="#121417" strokeWidth="1" />

			{/* Divine Body Coils (Foreground lower arc) */}
			<path
				d="M 20 84 C 35 70 65 70 80 84 C 65 94 35 94 20 84 Z"
				fill={color}
				stroke="#121417"
				strokeWidth="3"
			/>
		</svg>
	);
}