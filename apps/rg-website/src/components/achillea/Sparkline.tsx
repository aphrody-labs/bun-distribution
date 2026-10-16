"use client";

import { useId } from "react";

interface SparklineProps {
	data?: number[];
	width?: number;
	height?: number;
	showLastPoint?: boolean;
	className?: string;
}

export function Sparkline({
	data = [],
	width = 120,
	height = 36,
	showLastPoint = true,
	className,
}: SparklineProps) {
	const id = useId();
	const gradientId = `spark-grad-${id.replace(/:/g, "")}`;

	// Trace l'évolution cumulée (somme préfixe) plutôt que les deltas bruts
	const cumulative: number[] = [];
	let acc = 0;
	for (const v of data) {
		acc += Number(v) || 0;
		cumulative.push(acc);
	}

	if (cumulative.length < 2) {
		return <span className="opacity-50 text-xs">—</span>;
	}

	const last = cumulative[cumulative.length - 1] ?? 0;
	const trend = last > 0 ? "up" : last < 0 ? "down" : "flat";
	const strokeColor =
		trend === "up" ? "#34d399" : trend === "down" ? "#f87171" : "#94a3b8";

	const pad = 2;
	const min = Math.min(...cumulative);
	const max = Math.max(...cumulative);
	const span = max - min || 1;

	const points = cumulative.map((v, i) => ({
		x: pad + (i * (width - pad * 2)) / (cumulative.length - 1),
		y: height - pad - ((v - min) * (height - pad * 2)) / span,
	}));

	const line = points
		.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
		.join(" ");

	const firstPt = points[0]!;
	const lastPt = points[points.length - 1]!;
	const area = `${line} L${lastPt.x.toFixed(2)},${height} L${firstPt.x.toFixed(2)},${height} Z`;

	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			style={{ width, height }}
			className={`inline-block overflow-visible ${className ?? ""}`}
			preserveAspectRatio="none"
		>
			<defs>
				<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor={strokeColor} stopOpacity="0.45" />
					<stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
				</linearGradient>
			</defs>
			<path d={area} fill={`url(#${gradientId})`} />
			<path
				d={line}
				fill="none"
				stroke={strokeColor}
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			{showLastPoint && (
				<circle cx={lastPt.x} cy={lastPt.y} r="2.4" fill={strokeColor} />
			)}
		</svg>
	);
}
