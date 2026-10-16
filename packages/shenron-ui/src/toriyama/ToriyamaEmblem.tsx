/**
 * ToriyamaEmblem — Official Dragon Ball Kanji & Faction Insignias in Pure SVG.
 */

import type { SVGProps } from "react";
import { EMBLEMS, type EmblemDefinition } from "../toriyama-svg";

export type EmblemName = keyof typeof EMBLEMS;

export interface ToriyamaEmblemProps extends Omit<SVGProps<SVGSVGElement>, "size"> {
	name: EmblemName;
	size?: number | string;
	/** Display variant: "badge" adds an outer shaded badge border, "flat" is clean print */
	variant?: "flat" | "badge" | "monochrome";
	title?: string;
	decorative?: boolean;
}

export function ToriyamaEmblem({
	name,
	size = 48,
	variant = "badge",
	className = "",
	title,
	decorative = false,
	...props
}: ToriyamaEmblemProps) {
	const def: EmblemDefinition = EMBLEMS[name] ?? EMBLEMS.kame;
	const a11y = decorative
		? { "aria-hidden": true as const }
		: { role: "img" as const, "aria-label": title ?? def.title };

	const isMono = variant === "monochrome";

	return (
		<svg
			viewBox={def.viewBox}
			width={size}
			height={size}
			className={`inline-block shrink-0 transition-transform duration-150 ${className}`}
			style={{
				filter: variant === "badge" ? "drop-shadow(2px 3px 0px #121417)" : undefined,
			}}
			{...a11y}
			{...props}
		>
			{/* Optional colored outer ring if badge */}
			{variant === "badge" && def.bgCircleColor && (
				<circle cx="50" cy="50" r="48" fill={def.bgCircleColor} />
			)}

			{def.paths.map((p, idx) => {
				const fill = isMono
					? (p.fill ? "currentColor" : "none")
					: (p.fill ?? "none");
				const stroke = isMono
					? (p.stroke ? "currentColor" : undefined)
					: p.stroke;

				return (
					<path
						key={idx}
						d={p.d}
						fill={fill}
						stroke={stroke}
						strokeWidth={p.strokeWidth}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				);
			})}
		</svg>
	);
}

export const EmblemKame = (props: Omit<ToriyamaEmblemProps, "name">) => (
	<ToriyamaEmblem name="kame" {...props} />
);
export const EmblemGo = (props: Omit<ToriyamaEmblemProps, "name">) => (
	<ToriyamaEmblem name="go" {...props} />
);
export const EmblemKai = (props: Omit<ToriyamaEmblemProps, "name">) => (
	<ToriyamaEmblem name="kai" {...props} />
);
export const EmblemDemon = (props: Omit<ToriyamaEmblemProps, "name">) => (
	<ToriyamaEmblem name="demon" {...props} />
);
export const EmblemCapsuleCorp = (props: Omit<ToriyamaEmblemProps, "name">) => (
	<ToriyamaEmblem name="capsuleCorp" {...props} />
);
export const EmblemRedRibbon = (props: Omit<ToriyamaEmblemProps, "name">) => (
	<ToriyamaEmblem name="redRibbon" {...props} />
);
export const EmblemMajin = (props: Omit<ToriyamaEmblemProps, "name">) => (
	<ToriyamaEmblem name="majin" {...props} />
);
export const EmblemTenkaichi = (props: Omit<ToriyamaEmblemProps, "name">) => (
	<ToriyamaEmblem name="tenkaichi" {...props} />
);
export const EmblemVegetaRoyal = (props: Omit<ToriyamaEmblemProps, "name">) => (
	<ToriyamaEmblem name="vegetaRoyal" {...props} />
);
