"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";



export function CartIconButton({ initialCount }: { initialCount: number }) {
	const count = initialCount;

	return (
		<Link
			href="/shop/panier"
			aria-label={`Voir le panier (${count} article${count > 1 ? "s" : ""})`}
			className="group relative inline-flex size-11 items-center justify-center rounded-full border-2 border-[#d4af37] bg-[#0c1730] text-[#d4af37] shadow-[0_3px_0_0_rgba(0,0,0,0.5)] transition-transform motion-safe:duration-200 hover:-translate-y-0.5 hover:bg-[#d4af37] hover:text-[#0c1730] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[#d4af37]/50"
		>
			<ShoppingBag className="size-5" aria-hidden />
			{count > 0 && (
				<span
					aria-hidden
					className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#a14b3f] px-1 text-[11px] font-extrabold leading-none text-white ring-2 ring-[#0c1730]"
				>
					{count > 99 ? "99+" : count}
				</span>
			)}
		</Link>
	);
}
