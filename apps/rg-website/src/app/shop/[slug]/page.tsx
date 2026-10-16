import { ArrowLeft, Check } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CATEGORY_LABELS, PRODUCTS, formatEuros, getProduct } from "@/lib/shop/products";
import { absoluteUrl, SITE_URL } from "@/lib/site-url";
import { PatreonDiscountBanner } from "../_components/patreon-discount-banner";
import { ProductCard } from "../_components/product-card";
import { VariantPickerWithCta } from "../_components/variant-picker";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return PRODUCTS.map(p => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) {
    return { title: "Produit introuvable · Rose Griffon" };
  }
  return {
    alternates: { canonical: absoluteUrl(`/shop/${product.slug}`) },
    description: product.tagline,
    openGraph: {
      description: product.tagline,
      images: [product.image],
      title: product.name,
    },
    title: `${product.name} · Boutique Rose Griffon`,
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) {
    notFound();
  }

  const gallery = product.gallery ?? [product.image];
  const related = PRODUCTS.filter(p => p.category === product.category && p.slug !== product.slug).slice(0, 4);

  const stockHintToAvailability = (hint: typeof product.stockHint): string => {
    switch (hint) {
      case "low-stock":
      case "limited": {
        return "https://schema.org/LimitedAvailability";
      }
      case "preorder": {
        return "https://schema.org/PreOrder";
      }
      default: {
        return "https://schema.org/InStock";
      }
    }
  };

  const baseUrl = SITE_URL;
  const allImages = [
    `${baseUrl}${product.image}`,
    ...(product.gallery ?? []).filter(src => src !== product.image).map(src => `${baseUrl}${src}`),
  ];

  const offersSchema = product.variants
    ? {
        "@type": "AggregateOffer",
        highPrice: Math.max(...product.variants.map(v => (v.priceCentsOverride ?? product.priceCents) / 100)).toFixed(
          2,
        ),
        lowPrice: Math.min(...product.variants.map(v => (v.priceCentsOverride ?? product.priceCents) / 100)).toFixed(2),
        offerCount: product.variants.length,
        offers: product.variants.map(v => ({
          "@type": "Offer",
          name: v.label,
          priceCurrency: "EUR",
          price: ((v.priceCentsOverride ?? product.priceCents) / 100).toFixed(2),
          availability: stockHintToAvailability(product.stockHint),
          itemCondition: "https://schema.org/NewCondition",
          url: `${baseUrl}/shop/${product.slug}`,
          seller: {
            "@type": "Organization",
            name: "Association Rose Griffon",
          },
        })),
        priceCurrency: "EUR",
      }
    : {
        "@type": "Offer",
        availability: stockHintToAvailability(product.stockHint),
        itemCondition: "https://schema.org/NewCondition",
        price: (product.priceCents / 100).toFixed(2),
        priceCurrency: "EUR",
        seller: {
          "@type": "Organization",
          name: "Association Rose Griffon",
        },
        url: `${baseUrl}/shop/${product.slug}`,
      };

  const productSchema = {
    "@context": "https://schema.org/",
    "@type": "Product",
    brand: { "@type": "Brand", name: "Rose Griffon" },
    category: CATEGORY_LABELS[product.category],
    description: product.description,
    image: allImages,
    name: product.name,
    offers: offersSchema,
    sku: product.slug,
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        item: baseUrl,
        name: "Accueil",
        position: 1,
      },
      {
        "@type": "ListItem",
        item: `${baseUrl}/shop`,
        name: "Boutique",
        position: 2,
      },
      {
        "@type": "ListItem",
        item: `${baseUrl}/shop/${product.slug}`,
        name: product.name,
        position: 3,
      },
    ],
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 md:px-8 md:pt-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <nav aria-label="Fil d'Ariane" className="mb-6">
        <Link
          href="/shop"
          className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/70 transition-colors motion-safe:duration-200 hover:text-[#d4af37]"
        >
          <ArrowLeft className="size-4" />
          <span>Retour catalogue</span>
        </Link>
      </nav>

      <div className="grid gap-10 md:grid-cols-12 md:gap-12 lg:gap-16">
        {/* Gallery */}
        <section className="md:col-span-7">
          <div className="relative overflow-hidden rounded-3xl border-2 border-[#d4af37]/50 bg-[#0c1730] shadow-[0_8px_0_0_rgba(0,0,0,0.4)]">
            <div className="relative aspect-[4/3]">
              <Image
                src={gallery[0]!}
                alt={product.name}
                fill
                sizes="(max-width: 768px) 100vw, 60vw"
                className="object-cover"
                priority
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-[#0c1730]/40 via-transparent to-transparent"
              />
            </div>
            {gallery.length > 1 && (
              <div className="grid grid-cols-4 gap-2 border-t-2 border-[#d4af37]/40 p-3">
                {gallery.map((src, i) => (
                  <div
                    key={src}
                    className="relative aspect-square overflow-hidden rounded-xl border-2 border-[#d4af37]/30 bg-[#0c1730]"
                  >
                    <Image
                      src={src}
                      alt={`${product.name} — vue ${i + 1}`}
                      fill
                      sizes="120px"
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Buy column */}
        <section className="md:col-span-5">
          <div className="sticky top-24 flex flex-col gap-6">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border-2 border-[#d4af37]/40 bg-[#0c1730] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#d4af37]">
                {CATEGORY_LABELS[product.category]}
              </p>
              <h1 className="mt-3 text-balance text-fluid-headline-xl font-extrabold leading-tight tracking-tight text-white">
                {product.name}
              </h1>
              <p className="mt-2 text-base text-white/70">{product.tagline}</p>
            </div>

            <Suspense
              fallback={<div className="h-20 animate-pulse rounded-2xl border-2 border-[#d4af37]/30 bg-[#0c1730]/40" />}
            >
              <PatreonDiscountBanner />
            </Suspense>

            <div className="rounded-3xl border-2 border-[#d4af37]/40 bg-[#0c1730]/60 p-5 shadow-[0_4px_0_0_rgba(0,0,0,0.4)]">
              <VariantPickerWithCta product={product} />
            </div>

            {product.highlights && (
              <div>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-[#d4af37]">Contenu du pack</h2>
                <ul className="space-y-2">
                  {product.highlights.map(h => (
                    <li key={h} className="flex items-start gap-3 text-sm text-white/85">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#d4af37]" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 border-t-2 border-[#d4af37]/30 pt-5 text-xs uppercase tracking-widest text-white/60">
              <span>Prix</span>
              <span className="text-right text-white">{formatEuros(product.priceCents)}</span>
              <span>Livraison FR</span>
              <span className="text-right text-white">4,90 €</span>
              <span>Délai</span>
              <span className="text-right text-white">3-7 jours</span>
            </div>
          </div>
        </section>
      </div>

      {/* Description longue */}
      <section className="mt-16 grid gap-8 md:grid-cols-12">
        <div className="md:col-span-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-[#d4af37]">Description</h2>
          <p className="mt-4 text-pretty text-lg leading-relaxed text-white/85">{product.description}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {product.tags.map(t => (
              <span
                key={t}
                className="inline-flex items-center rounded-full border border-[#d4af37]/40 bg-[#0c1730]/60 px-3 py-1 text-xs font-semibold text-white/70"
              >
                #{t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Related */}
      {related.length > 0 && (
        <section aria-label="Produits similaires" className="mt-20">
          <h2 className="mb-6 text-xs font-bold uppercase tracking-widest text-[#d4af37]">Tu aimeras aussi</h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {related.map(p => (
              <ProductCard key={p.slug} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
