"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { CATEGORY_LABELS } from "@/lib/shop/products";
import type { ProductCategory } from "@/lib/shop/products";

const CATEGORIES: (ProductCategory | "all")[] = [
	"all",
	"pack-patreon",
	"print",
	"sticker",
	"marque-page",
	"badge",
	"textile",
	"affiche",
	"carte",
	"digital",
];

export function CategoryFilter({ active }: { active: string }) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [pending, startTransition] = useTransition();

	const set = (cat: string) => {
		const params = new URLSearchParams(searchParams.toString());
		if (cat === "all") {
			params.delete("cat");
		} else {
			params.set("cat", cat);
		}
		startTransition(() => router.replace(`/shop?${params.toString()}`));
	};

	return (
		<div
			role="tablist"
			aria-label="Filtrer par catégorie"
			className="flex flex-wrap items-center gap-2"
			data-pending={pending || undefined}
		>
			{CATEGORIES.map((cat) => {
				const isActive = cat === active || (cat === "all" && active === "");
				const label = cat === "all" ? "Tout" : CATEGORY_LABELS[cat];
				return (
					<button
						key={cat}
						type="button"
						role="tab"
						aria-selected={isActive}
						onClick={() => set(cat)}
						className={`inline-flex h-9 items-center rounded-full border-2 px-4 text-xs font-bold uppercase tracking-wider transition-all motion-safe:duration-200 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[#d4af37]/50 ${
							isActive
								? "border-[#d4af37] bg-[#d4af37] text-[#0c1730] shadow-[0_2px_0_0_rgba(0,0,0,0.4)]"
								: "border-[#d4af37]/40 bg-[#0c1730]/60 text-[#d4af37] hover:border-[#d4af37] hover:bg-[#0c1730]"
						}`}
					>
						{label}
					</button>
				);
			})}
		</div>
	);
}
