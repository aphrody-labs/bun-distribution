import type * as React from "react";

import { cn } from "../lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"flex h-10 w-full min-w-0 rounded-xl border-2 border-black/80 bg-[#121218] px-3.5 py-2 text-sm text-gray-100 transition-all outline-none selection:bg-dbz-orange selection:text-black placeholder:text-gray-500",
				"focus-visible:border-dbz-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/20",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"aria-invalid:border-destructive dark:aria-invalid:border-destructive/50",
				className
			)}
			{...props}
		/>
	);
}

export { Input };
