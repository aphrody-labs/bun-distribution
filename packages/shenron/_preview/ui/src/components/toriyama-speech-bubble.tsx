/**
 * ToriyamaSpeechBubble — Manga Dialogue & Battle Shout Balloon Primitive.
 * Features normal dialogue bubbles, jagged shout balloons, and positional directional pointers.
 */

import type { ReactNode } from "react";

export interface ToriyamaSpeechBubbleProps {
	children: ReactNode;
	variant?: "normal" | "shout" | "thought";
	tailPosition?: "bottom" | "top" | "left" | "right";
	className?: string;
}

export function ToriyamaSpeechBubble({
	children,
	variant = "normal",
	tailPosition = "bottom",
	className = "",
}: ToriyamaSpeechBubbleProps) {
	const isShout = variant === "shout";

	const tailStyles = {
		bottom: "after:bottom-[-10px] after:left-8 after:border-t-[10px] after:border-t-[var(--color-toriyama-ink,#121417)] after:border-x-[8px] after:border-x-transparent",
		top: "after:top-[-10px] after:left-8 after:border-b-[10px] after:border-b-[var(--color-toriyama-ink,#121417)] after:border-x-[8px] after:border-x-transparent",
		left: "after:left-[-10px] after:top-6 after:border-r-[10px] after:border-r-[var(--color-toriyama-ink,#121417)] after:border-y-[8px] after:border-y-transparent",
		right: "after:right-[-10px] after:top-6 after:border-l-[10px] after:border-l-[var(--color-toriyama-ink,#121417)] after:border-y-[8px] after:border-y-transparent",
	};

	return (
		<div
			className={`relative p-4 font-bold text-[var(--color-toriyama-ink,#121417)] bg-white border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[3px_3px_0px_var(--color-toriyama-ink,#121417)] after:content-[''] after:absolute after:w-0 after:h-0 ${
				isShout ? "border-3 font-black uppercase tracking-wider" : "rounded-xl"
			} ${tailStyles[tailPosition]} ${className}`}
		>
			{children}
		</div>
	);
}