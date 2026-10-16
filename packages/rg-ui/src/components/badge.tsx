import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/utils";

const badgeVariants = cva(
	"inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-hidden",
	{
		variants: {
			variant: {
				default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
				secondary:
					"border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
				destructive:
					"border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
				// `success`/`warning` ne sont pas des tokens : le design system les
				// nomme `succes` et `alerte`. La variante rendait un fond transparent.
				success: "border-transparent bg-succes text-on-succes hover:bg-succes/80",
				warning: "border-transparent bg-alerte text-on-alerte hover:bg-alerte/80",
				info: "border-transparent bg-info text-on-info hover:bg-info/80",
				outline: "text-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	}
);

export interface BadgeProps
	extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
	asChild?: boolean;
}

function Badge({ className, variant, asChild = false, ...props }: BadgeProps) {
	const Comp = asChild ? Slot : "div";

	return (
		<Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
	);
}

export { Badge, badgeVariants };
