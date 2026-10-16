"use client";

import { Check, Loader2, Plus, ShoppingBag } from "lucide-react";
import { useState, useTransition } from "react";

import { addToCart } from "@/lib/shop/cart";
import type { Product } from "@/lib/shop/products";

interface AddToCartProps {
	product: Product;
	variantId?: string;
	size?: "default" | "lg";
	className?: string;
}

export function AddToCart({
	product,
	variantId,
	size = "default",
	className = "",
}: AddToCartProps) {
	const [pending, startTransition] = useTransition();
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const isLarge = size === "lg";
	const requiresVariant = (product.variants?.length ?? 0) > 0;
	const disabled = requiresVariant && !variantId;

	const handle = () => {
		setError(null);
		startTransition(async () => {
			try {
				await addToCart(product.slug, variantId, 1);
				setSuccess(true);
				setTimeout(() => setSuccess(false), 2000);
			} catch (error) {
				setError(error instanceof Error ? error.message : "Erreur panier");
			}
		});
	};

	return (
		<div className={className}>
			<button
				type="button"
				onClick={handle}
				disabled={disabled || pending}
				className={`group inline-flex items-center justify-center gap-2 rounded-full bg-[#d4af37] font-extrabold uppercase tracking-wider text-[#0c1730] shadow-[0_3px_0_0_rgba(0,0,0,0.4)] transition-all motion-safe:duration-200 hover:-translate-y-0.5 hover:bg-[#e8c668] hover:shadow-[0_5px_0_0_rgba(0,0,0,0.5)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[#d4af37]/50 ${
					isLarge ? "h-12 w-full px-6 text-sm" : "h-10 px-5 text-xs"
				}`}
				aria-label={`Ajouter ${product.name} au panier`}
			>
				{pending ? (
					<Loader2 className={`animate-spin ${isLarge ? "size-5" : "size-4"}`} />
				) : success ? (
					<>
						<Check className={isLarge ? "size-5" : "size-4"} />
						<span>Ajouté !</span>
					</>
				) : (
					<>
						{isLarge ? <ShoppingBag className="size-5" /> : <Plus className="size-4" />}
						<span>
							{disabled ? "Choisis une option" : isLarge ? "Ajouter au panier" : "Au panier"}
						</span>
					</>
				)}
			</button>
			{error && <p className="mt-2 text-xs font-semibold text-[#a14b3f]">{error}</p>}
		</div>
	);
}
