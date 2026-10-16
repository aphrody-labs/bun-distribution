"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import type * as React from "react";

import { cn } from "../lib/utils";

const RadioGroup = RadioGroupPrimitive;

function RadioItem({
	className,
	children,
	...props
}: React.ComponentProps<typeof RadioPrimitive.Root> & {
	children?: React.ReactNode;
}) {
	return (
		<RadioPrimitive.Root
			className={cn(
				"group relative flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-black bg-[#121218] outline-none transition-all cursor-pointer",
				"hover:border-dbz-orange",
				"active:translate-x-px active:translate-y-px",
				"data-[checked]:border-dbz-orange data-[checked]:bg-black",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/40",
				className
			)}
			{...props}
		>
			<RadioPrimitive.Indicator className="size-2.5 rounded-full bg-dbz-orange" />
			{children}
		</RadioPrimitive.Root>
	);
}

export { RadioGroup, RadioItem };
