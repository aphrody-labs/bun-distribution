"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type * as React from "react";

import { cn } from "../lib/utils";

function Toggle({ className, ...props }: React.ComponentProps<typeof TogglePrimitive>) {
	return (
		<TogglePrimitive
			className={cn(
				"inline-flex h-9 min-w-9 items-center justify-center rounded-lg border-2 border-black bg-[#121218] px-3 text-xs font-sans font-extrabold uppercase tracking-wider text-gray-300 outline-none transition-all cursor-pointer",
				"hover:border-dbz-orange hover:text-white",
				"active:translate-x-px active:translate-y-px",
				"data-[pressed]:bg-dbz-orange data-[pressed]:text-black data-[pressed]:border-black",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/40",
				className
			)}
			{...props}
		/>
	);
}

function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive>) {
	return (
		<ToggleGroupPrimitive
			className={cn("inline-flex flex-wrap items-center gap-2", className)}
			{...props}
		/>
	);
}

export { Toggle, ToggleGroup };
