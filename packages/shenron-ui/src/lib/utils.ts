import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names with `clsx` (strings, arrays, conditional objects), then
 * resolves Tailwind conflicts with `tailwind-merge`: the last utility of a
 * group wins (`cn("px-2", "px-4")` → `"px-4"`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
