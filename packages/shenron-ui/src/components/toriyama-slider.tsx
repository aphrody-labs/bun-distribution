/**
 * ToriyamaSlider — Dragon Ball & Scouter Themed Interactive Slider Primitive.
 * Features a Dragon Ball Sphere as the draggable thumb, dynamically reflecting the star count.
 */

"use client";

import { useState } from "react";
import { DragonBallSphere, type DragonBallStarsCount } from "../toriyama/DragonBallSphere";

export interface ToriyamaSliderProps {
	min?: number;
	max?: number;
	step?: number;
	defaultValue?: number;
	value?: number;
	onChange?: (value: number) => void;
	mode?: "dragonball" | "scouter";
	label?: string;
	className?: string;
}

export function ToriyamaSlider({
	min = 1,
	max = 7,
	step = 1,
	defaultValue = 4,
	value: controlledValue,
	onChange,
	mode = "dragonball",
	label,
	className = "",
}: ToriyamaSliderProps) {
	const [internalValue, setInternalValue] = useState(defaultValue);
	const isControlled = controlledValue !== undefined;
	const currentValue = isControlled ? controlledValue : internalValue;

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = Number(e.target.value);
		if (!isControlled) setInternalValue(val);
		onChange?.(val);
	};

	const safeMin = Number.isFinite(min) ? min : 1;
	const safeMax = Number.isFinite(max) ? Math.max(max, safeMin + 1) : 7;
	const safeValue = Number.isFinite(currentValue) ? Math.min(safeMax, Math.max(safeMin, currentValue)) : safeMin;
	const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
	const percentage = ((safeValue - safeMin) / (safeMax - safeMin)) * 100;
	const stars = Math.min(7, Math.max(1, Math.round(safeValue))) as DragonBallStarsCount;

	return (
		<div className={`flex flex-col gap-2 select-none ${className}`}>
			{label && (
				<div className="flex justify-between items-center text-xs font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">
					<span>{label}</span>
					<span className="font-mono text-sm text-[var(--color-toriyama-orange,#f85b1a)]">
						{mode === "dragonball" ? `${stars} ★` : `BP: ${safeValue}`}
					</span>
				</div>
			)}

			<div className="relative flex items-center w-full h-10">
				{/* Background track */}
				<div className="absolute w-full h-3 bg-[#18181b] border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[2px_2px_0px_var(--color-toriyama-ink,#121417)] rounded-full overflow-hidden">
					<div
						className={`h-full transition-all duration-75 ${
							mode === "dragonball"
								? "bg-gradient-to-r from-[var(--color-toriyama-orange,#f85b1a)] to-[var(--color-toriyama-gold,#ffd700)]"
								: "bg-[var(--color-toriyama-scouter-green,#00ff66)]"
						}`}
						style={{ width: `${percentage}%` }}
					/>
				</div>

				{/* Visual Thumb representation */}
				<div
					className="absolute pointer-events-none transition-all duration-75 -translate-x-1/2"
					style={{ left: `${percentage}%` }}
				>
					{mode === "dragonball" ? (
						<DragonBallSphere stars={stars} size={34} glow decorative />
					) : (
						<div className="w-8 h-8 rounded-full border-2 border-[var(--color-toriyama-scouter-green,#00ff66)] bg-[#0b2528] flex items-center justify-center shadow-[0_0_8px_#00ff66]">
							<span className="text-[9px] font-mono text-[var(--color-toriyama-scouter-green,#00ff66)] font-black">
								{safeValue}
							</span>
						</div>
					)}
				</div>

				{/* Hidden HTML Range Input for accessibility & drag handling */}
				<input
					type="range"
					min={safeMin}
					max={safeMax}
					step={safeStep}
					value={safeValue}
					onChange={handleChange}
					aria-label={label ?? (mode === "dragonball" ? "Étoiles Dragon Ball" : "Puissance de combat")}
					className="absolute w-full h-8 opacity-0 cursor-pointer"
				/>
			</div>
		</div>
	);
}
