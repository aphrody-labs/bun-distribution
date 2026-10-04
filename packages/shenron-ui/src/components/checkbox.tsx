"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";

function Checkbox({
	className,
	...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
	return (
		<CheckboxPrimitive.Root
			className={cn(
				"peer size-5 shrink-0 rounded-md border-2 border-black bg-[#121218] shadow-[2px_2px_0px_#000] transition-all outline-none cursor-pointer",
				"hover:border-dbz-orange hover:shadow-[3px_3px_0px_#000]",
				"active:translate-x-px active:translate-y-px active:shadow-none",
				"data-[checked]:bg-dbz-orange data-[checked]:text-black data-[checked]:border-black",
				"focus-visible:ring-2 focus-visible:ring-dbz-orange/40",
				className
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
				<Check className="size-3.5 stroke-[3.5] data-[indeterminate]:hidden" />
				<Minus className="hidden size-3.5 stroke-[3.5] data-[indeterminate]:block" />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
