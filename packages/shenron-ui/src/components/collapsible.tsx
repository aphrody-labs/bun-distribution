"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import type * as React from "react";

import { cn } from "../lib/utils";

const Collapsible = CollapsiblePrimitive.Root;
const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

function CollapsiblePanel({
	className,
	...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Panel>) {
	return (
		<CollapsiblePrimitive.Panel
			className={cn("overflow-hidden transition-all data-[ending-style]:opacity-0 data-[starting-style]:opacity-0", className)}
			{...props}
		/>
	);
}

export { Collapsible, CollapsibleTrigger, CollapsiblePanel };
