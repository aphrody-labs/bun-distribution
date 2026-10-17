import { describe, expect, test } from "bun:test";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { cn } from "./utils";

describe("cn", () => {
  test("joins strings, nested arrays and conditional objects", () => {
    expect(
      cn("flex", ["items-center", ["gap-2"]], {
        hidden: false,
        "w-full": true,
      }),
    ).toBe("flex items-center gap-2 w-full");
  });

  test("drops falsy inputs", () => {
    expect(cn("text-white", undefined, null, false, 0, "", "font-bold")).toBe("text-white font-bold");
    expect(cn()).toBe("");
  });

  test("the last utility of a conflicting group wins", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
    expect(cn("rounded-lg", { "rounded-xl": true })).toBe("rounded-xl");
  });

  test("is exactly twMerge(clsx(inputs)), the implementation the site and the bot used", () => {
    const cases: ClassValue[][] = [
      ["px-2 py-1", "px-4"],
      ["flex", { hidden: true, flex: false }],
      [["inline-flex", "items-center"], "justify-center", undefined],
      ["p-4", "px-2", "py-3", "p-1"],
      ["text-white/70", "hover:text-white", "hover:bg-white/[0.06]"],
      ["h-11 min-w-11", "h-10", "min-w-10"],
      ["", null, false, 0, "border-2 border-black", "border-white/20"],
    ];
    for (const inputs of cases) expect(cn(...inputs)).toBe(twMerge(clsx(inputs)));
  });
});
