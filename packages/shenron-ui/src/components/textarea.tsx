import type * as React from "react";

import { cn } from "../lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content flex min-h-20 w-full rounded-xl border-2 border-black/80 bg-[#121218] px-3.5 py-2.5 text-sm text-gray-100 shadow-[2px_2px_0px_#000] transition-all outline-none selection:bg-dbz-orange selection:text-black placeholder:text-gray-500",
        "focus-visible:border-dbz-orange focus-visible:shadow-[3px_3px_0px_#000] focus-visible:ring-2 focus-visible:ring-dbz-orange/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
