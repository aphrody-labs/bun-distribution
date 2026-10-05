"use client";

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import type * as React from "react";

import { cn } from "../lib/utils";

function Separator({
	className,
	orientation = "horizontal",
	variant = "default",
	...props
}: React.ComponentProps<typeof SeparatorPrimitive> & {
	variant?: "default" | "ki" | "speedline";
}) {
	const variants = {
		default: "bg-black/80 border-b border-white/10",
		ki: "bg-gradient-to-r from-transparent via-dbz-orange to-transparent h-0.5",
		speedline: "bg-gradient-to-r from-white/40 via-dbz-yellow to-transparent h-0.5",
	};

	return (
		<SeparatorPrimitive
			orientation={orientation}
			className={cn(
				"shrink-0",
				orientation === "horizontal" ? "h-0.5 w-full" : "h-full w-0.5",
				variants[variant],
				className
			)}
			{...props}
		/>
	);
}

export { Separator };
