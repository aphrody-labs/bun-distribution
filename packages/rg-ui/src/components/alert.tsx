import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/utils";

const alertVariants = cva(
	"relative w-full rounded-lg border p-4 [&>svg~*]:ps-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:start-4 [&>svg]:top-4 [&>svg]:text-foreground",
	{
		variants: {
			variant: {
				default: "bg-background text-foreground",
				destructive:
					"border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
				// Les tokens du design system sont `succes` et `alerte` (nommage FR,
				// cf. styles.css). `success`/`warning` n'existent pas : ces deux
				// variantes rendaient une bordure et un texte transparents.
				success: "border-succes/50 text-succes dark:border-succes [&>svg]:text-succes",
				warning: "border-alerte/50 text-alerte dark:border-alerte [&>svg]:text-alerte",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	}
);

function Alert({
	className,
	variant,
	...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
	return (
		<div
			data-slot="alert"
			role="alert"
			aria-live="polite"
			className={cn(alertVariants({ variant }), className)}
			{...props}
		/>
	);
}

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
	return (
		<h5
			data-slot="alert-title"
			className={cn("mb-1 font-medium leading-none tracking-tight", className)}
			{...props}
		/>
	);
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
	return (
		<div
			data-slot="alert-description"
			className={cn("text-sm [&_p]:leading-relaxed", className)}
			{...props}
		/>
	);
}

export { Alert, AlertDescription, AlertTitle };
