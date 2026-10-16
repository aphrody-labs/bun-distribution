import { ArrowLeft, MapPin, Package, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createPostgresClient } from "@rosegriffon/db/service";
import { formatEuros, getProduct } from "@/lib/shop/products";
import { getServerUser } from "@/lib/auth-helpers";

export const metadata = {
	robots: { follow: false, index: false },
	title: "Détail commande · Boutique Rose Griffon",
};

const STATUS_LABEL = {
	canceled: "Annulée",
	delivered: "Livrée",
	failed: "Échec",
	paid: "Payée",
	pending: "En attente",
	refunded: "Remboursée",
	shipped: "Expédiée",
} as const;

interface OrderDetail {
	id: string;
	stripe_session_id: string;
	amount_subtotal_cents: number;
	amount_discount_cents: number;
	amount_shipping_cents: number;
	amount_tax_cents: number;
	amount_total_cents: number;
	patron_discount_applied: boolean;
	shipping_address: {
		line1?: string;
		line2?: string;
		city?: string;
		state?: string;
		postal_code?: string;
		country?: string;
	} | null;
	shipping_name: string | null;
	shipping_email: string | null;
	shipping_phone: string | null;
	status: keyof typeof STATUS_LABEL;
	tracking_number: string | null;
	tracking_carrier: string | null;
	created_at: string;
	paid_at: string | null;
	shipped_at: string | null;
	delivered_at: string | null;
	items:
		| {
				slug?: string;
				label?: string;
				qty?: number;
				unit_amount_cents?: number;
				variantId?: string;
		  }[]
		| null;
}

async function fetchOrder(orderId: string, userId: string): Promise<OrderDetail | null> {
	try {
		const { data, error } = await createPostgresClient()
			.from("orders")
			.select("*")
			.eq("id", orderId)
			.eq("user_id", userId)
			.maybeSingle();
		if (error || !data) {
			return null;
		}
		return data as unknown as OrderDetail;
	} catch {
		return null;
	}
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const user = await getServerUser();
	if (!user) {
		redirect(`/login?redirect=${encodeURIComponent(`/shop/commandes/${id}`)}`);
	}

	const order = await fetchOrder(id, user.id);
	if (!order) {
		notFound();
	}

	return (
		<div className="mx-auto max-w-4xl px-4 pb-16 pt-10 md:px-8 md:pt-16">
			<nav className="mb-6">
				<Link
					href="/shop/commandes"
					className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/70 hover:text-[#d4af37]"
				>
					<ArrowLeft className="size-4" />
					<span>Mes commandes</span>
				</Link>
			</nav>

			<header className="mb-8">
				<p className="text-[10px] font-bold uppercase tracking-widest text-[#d4af37]">
					Commande #{order.id.slice(0, 8).toUpperCase()}
				</p>
				<h1 className="mt-1 text-fluid-headline-xl font-extrabold tracking-tight text-white">
					{STATUS_LABEL[order.status] ?? order.status}
				</h1>
				<p className="mt-2 text-sm text-white/70">
					Passée le{" "}
					{new Date(order.created_at).toLocaleDateString("fr-FR", {
						day: "2-digit",
						hour: "2-digit",
						minute: "2-digit",
						month: "long",
						year: "numeric",
					})}
				</p>
			</header>

			{/* Suivi */}
			{order.tracking_number && (
				<section className="mb-8 rounded-3xl border-2 border-[#d4af37]/50 bg-[#0c1730]/80 p-5 shadow-[0_4px_0_0_rgba(0,0,0,0.4)]">
					<h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#d4af37]">
						<Truck className="size-4" /> Suivi colis
					</h2>
					<p className="text-base font-semibold text-white">
						{order.tracking_carrier ?? "Transporteur"} —{" "}
						<span className="font-mono">{order.tracking_number}</span>
					</p>
				</section>
			)}

			<div className="grid gap-8 md:grid-cols-[1fr_320px]">
				<section aria-label="Articles">
					<h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#d4af37]">
						<Package className="size-4" />
						Articles ({order.items?.length ?? 0})
					</h2>
					<ul className="flex flex-col gap-3">
						{(order.items ?? []).map((item, idx) => {
							const product = item.slug ? getProduct(item.slug) : undefined;
							return (
								<li
									key={`${item.slug}-${item.variantId}-${idx}`}
									className="grid grid-cols-[80px_1fr_auto] items-center gap-4 rounded-2xl border-2 border-[#d4af37]/30 bg-[#0c1730]/60 p-3"
								>
									{product && (
										<div className="relative aspect-square overflow-hidden rounded-xl bg-[#0c1730]">
											<Image
												src={product.image}
												alt={item.label ?? product.name}
												fill
												sizes="80px"
												className="object-cover"
											/>
										</div>
									)}
									<div className="min-w-0">
										<p className="truncate text-sm font-bold text-white">
											{item.label ?? product?.name ?? "Produit"}
										</p>
										<p className="mt-0.5 text-xs text-white/60">Quantité {item.qty ?? 1}</p>
									</div>
									<span className="text-base font-extrabold text-white">
										{formatEuros((item.unit_amount_cents ?? 0) * (item.qty ?? 1))}
									</span>
								</li>
							);
						})}
					</ul>
				</section>

				<aside>
					<div className="flex flex-col gap-5 rounded-3xl border-2 border-[#d4af37]/50 bg-[#0c1730]/80 p-5 shadow-[0_4px_0_0_rgba(0,0,0,0.4)]">
						<h2 className="text-xs font-bold uppercase tracking-widest text-[#d4af37]">
							Récapitulatif
						</h2>
						<dl className="space-y-2 text-sm">
							<Row label="Sous-total" value={order.amount_subtotal_cents} />
							{order.amount_discount_cents > 0 && (
								<Row
									label="Réduction"
									value={-order.amount_discount_cents}
									highlight={order.patron_discount_applied}
								/>
							)}
							{order.amount_shipping_cents > 0 && (
								<Row label="Livraison" value={order.amount_shipping_cents} />
							)}
							{order.amount_tax_cents > 0 && <Row label="TVA" value={order.amount_tax_cents} />}
						</dl>
						<div className="flex items-end justify-between gap-3 border-t-2 border-[#d4af37]/30 pt-4">
							<span className="text-xs font-bold uppercase tracking-widest text-[#d4af37]">
								Total payé
							</span>
							<span className="text-3xl font-extrabold text-white">
								{formatEuros(order.amount_total_cents)}
							</span>
						</div>
					</div>

					{order.shipping_address && (
						<div className="mt-5 rounded-3xl border-2 border-[#d4af37]/40 bg-[#0c1730]/60 p-5">
							<h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#d4af37]">
								<MapPin className="size-4" /> Livraison
							</h2>
							<address className="not-italic text-sm text-white/85">
								{order.shipping_name && (
									<p className="font-semibold text-white">{order.shipping_name}</p>
								)}
								{order.shipping_address.line1 && <p>{order.shipping_address.line1}</p>}
								{order.shipping_address.line2 && <p>{order.shipping_address.line2}</p>}
								<p>
									{order.shipping_address.postal_code} {order.shipping_address.city}
								</p>
								<p className="font-semibold uppercase tracking-wider">
									{order.shipping_address.country}
								</p>
								{order.shipping_email && (
									<p className="mt-2 text-xs text-white/60">{order.shipping_email}</p>
								)}
							</address>
						</div>
					)}
				</aside>
			</div>
		</div>
	);
}

function Row({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
	return (
		<div className="flex items-center justify-between text-white/80">
			<dt>{label}</dt>
			<dd className={highlight ? "font-bold text-[#d4af37]" : "font-semibold text-white"}>
				{formatEuros(value)}
			</dd>
		</div>
	);
}
