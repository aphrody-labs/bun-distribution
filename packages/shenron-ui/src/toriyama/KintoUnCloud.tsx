/**
 * KintoUnCloud — Akira Toriyama's Flying Nimbus (Kinto-Un) in Pure Vector Geometry.
 * Features measured bulging lobes, inward spiral volutes, and manga dual-tone cell shading.
 */

import type { SVGProps } from "react";
import { arcs, volute, type Point } from "../toriyama-svg";

export interface KintoUnCloudProps extends Omit<SVGProps<SVGSVGElement>, "size"> {
	width?: number | string;
	height?: number | string;
	animated?: boolean;
	title?: string;
	decorative?: boolean;
}

// 7 key lobe anchor points measured from manga plates
const LOBE_POINTS: readonly Point[] = [
	[15, 65],
	[10, 42],
	[28, 22],
	[58, 18],
	[88, 30],
	[92, 58],
	[50, 72],
];

const LOBE_SAGITTAS: readonly number[] = [12, 14, 16, 18, 14, 12, 8];

export function KintoUnCloud({
	width = 120,
	height = 70,
	animated = false,
	className = "",
	title,
	decorative = false,
	...props
}: KintoUnCloudProps) {
	const a11y = decorative
		? { "aria-hidden": true as const }
		: { role: "img" as const, "aria-label": title ?? "Kinto-Un (Nuage Magique)" };

	const contour = arcs(LOBE_POINTS, LOBE_SAGITTAS, true);
	// Inward spiral volute flourishes
	const volute1 = volute([28, 22], [50, 45], 8, 1.2, 1);
	const volute2 = volute([92, 58], [50, 50], 10, 1.3, -1);

	return (
		<svg
			viewBox="0 0 110 85"
			width={width}
			height={height}
			className={`inline-block select-none ${animated ? "animate-bounce" : ""} ${className}`}
			style={{
				filter: "drop-shadow(2px 3px 0px #121417)",
				animationDuration: animated ? "2.4s" : undefined,
			}}
			{...a11y}
			{...props}
		>
			{/* Shading underbelly layer */}
			<path d={contour} fill="#e4be05" />

			{/* Main sunlight yellow upper body */}
			<path
				d={`${contour}`}
				fill="#fcf03a"
				style={{ clipPath: "polygon(0 0, 100% 0, 100% 70%, 0 85%)" }}
			/>

			{/* Outer black ink contour */}
			<path
				d={contour}
				fill="none"
				stroke="#121417"
				strokeWidth="3.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>

			{/* Volutes */}
			<path
				d={volute1}
				fill="none"
				stroke="#121417"
				strokeWidth="2.4"
				strokeLinecap="round"
			/>
			<path
				d={volute2}
				fill="none"
				stroke="#121417"
				strokeWidth="2.4"
				strokeLinecap="round"
			/>

			{/* Speedlines behind cloud */}
			{animated && (
				<g opacity="0.6">
					<line x1="2" y1="35" x2="14" y2="35" stroke="#ffb703" strokeWidth="2" strokeLinecap="round" />
					<line x1="0" y1="52" x2="10" y2="52" stroke="#ffb703" strokeWidth="2" strokeLinecap="round" />
				</g>
			)}
		</svg>
	);
}