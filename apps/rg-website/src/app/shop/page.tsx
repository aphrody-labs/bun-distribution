import { Suspense } from "react";

import { PRODUCTS } from "@/lib/shop/products";
import type { ProductCategory } from "@/lib/shop/products";
import { CategoryFilter } from "./_components/category-filter";
import { PatreonDiscountBanner } from "./_components/patreon-discount-banner";
import { ProductCard } from "./_components/product-card";

interface ShopPageProps {
  searchParams: Promise<{ cat?: string }>;
}

export default async function ShopIndexPage({ searchParams }: ShopPageProps) {
  const { cat = "" } = await searchParams;
  const filtered = cat && cat !== "all" ? PRODUCTS.filter(p => p.category === (cat as ProductCategory)) : PRODUCTS;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 min-[600px]:px-6 min-[600px]:pt-6">
      <section className="mb-6 grid gap-4 border-b border-[#d4af37]/30 pb-4 min-[840px]:grid-cols-12 min-[840px]:items-center">
        <header className="min-[840px]:col-span-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-white min-[840px]:text-3xl">
            Boutique <span className="text-[#d4af37]">Rose Griffon</span>
          </h1>
        </header>

        <aside className="min-[840px]:col-span-4">
          <Suspense
            fallback={<div className="h-24 animate-pulse rounded-2xl border-2 border-[#d4af37]/30 bg-[#0c1730]/60" />}
          >
            <PatreonDiscountBanner />
          </Suspense>
        </aside>
      </section>

      {/* Filters */}
      <section className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <CategoryFilter active={cat} />
        <p className="text-xs font-semibold uppercase tracking-widest text-white/60">
          {filtered.length} produit{filtered.length > 1 ? "s" : ""}
        </p>
      </section>

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <section
          aria-label="Catalogue produits"
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {filtered.map(p => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </section>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl border-2 border-dashed border-[#d4af37]/40 bg-[#0c1730]/40 p-16 text-center">
      <p className="text-4xl">🌹</p>
      <p className="mt-4 text-lg font-bold text-white">Aucun produit dans cette catégorie pour l'instant.</p>
      <p className="mt-2 text-sm text-white/60">Reviens vite — on prépare de nouveaux drops chaque mois.</p>
    </div>
  );
}
