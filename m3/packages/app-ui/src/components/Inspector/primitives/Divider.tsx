import { clsx } from "clsx";

interface DividerProps {
  className?: string;
}

/** M3 inset divider: 1 dp outline-variant. */
export function Divider({ className }: DividerProps) {
  return <hr className={clsx("mx-2 h-px border-0 bg-outline-variant", className)} />;
}
