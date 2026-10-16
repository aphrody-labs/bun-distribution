import Image from "next/image";
import Link from "next/link";

import { formatEuros, CATEGORY_LABELS } from "@/lib/shop/products";
import type { Product } from "@/lib/shop/products";

const STOCK_LABEL = {
	"in-stock": "En stock",
	limited: "Édition limitée",
	"low-stock": "Stock limité",
	preorder: "Précommande",
} as const;

const STOCK_TONE: Record<keyof typeof STOCK_LABEL, string> = {
	"in-stock": "bg-emerald-100 text-emerald-800 border-emerald-300",
	limited: "bg-rose-200 text-rose-900 border-rose-400",
	"low-stock": "bg-amber-100 text-amber-900 border-amber-400",
	preorder: "bg-sky-100 text-sky-800 border-sky-300",
};

export function ProductCard({ product }: { product: Product }) {
	const hasVariants = (product.variants?.length ?? 0) > 0;
	return (
		<Link
			href={`/shop/${product.slug}`}
			className="group relative isolate flex flex-col overflow-hidden rounded-3xl border-2 border-[#d4af37]/40 bg-[#0c1730] text-white shadow-[0_4px_0_0_rgba(0,0,0,0.5)] transition-all motion-safe:duration-300 hover:-translate-y-1 hover:shadow-[0_8px_0_0_rgba(0,0,0,0.6)] hover:border-[#d4af37]"
		>
			{/* Visual */}
			<div className="relative aspect-[4/3] overflow-hidden bg-[#0c1730]">
				<Image
					src={product.image}
					alt={product.name}
					fill
					sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
					className="object-cover transition-transform motion-safe:duration-500 group-hover:scale-105"
				/>
				{/* Vignette */}
				<div
					aria-hidden
					className="absolute inset-0 bg-gradient-to-t from-[#0c1730] via-transparent to-transparent"
				/>
				{/* Stock badge */}
				{product.stockHint && (
					<span
						className={`absolute right-3 top-3 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-md ${STOCK_TONE[product.stockHint]}`}
					>
						{STOCK_LABEL[product.stockHint]}
					</span>
				)}
				{/* Category tag */}
				<span className="absolute left-3 top-3 inline-flex items-center rounded-full border border-white/40 bg-[#0c1730]/80 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37] backdrop-blur">
					{CATEGORY_LABELS[product.category]}
				</span>
			</div>

			{/* Content */}
			<div className="flex flex-1 flex-col gap-3 p-5">
				<div>
					<h3 className="font-bold leading-tight text-white text-lg">{product.name}</h3>
					<p className="mt-1 text-sm text-white/70">{product.tagline}</p>
				</div>

				<div className="mt-auto flex items-end justify-between gap-3">
					<div>
						<span className="block text-[10px] font-bold uppercase tracking-widest text-[#d4af37]">
							{hasVariants ? "À partir de" : "Prix"}
						</span>
						<span className="block text-2xl font-extrabold text-white">
							{formatEuros(product.priceCents)}
						</span>
					</div>
					<span className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#0c1730] shadow-sm transition-transform motion-safe:duration-200 group-hover:scale-105">
						Voir →
					</span>
				</div>
			</div>
		</Link>
	);
}
