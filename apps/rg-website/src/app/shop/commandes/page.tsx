import { ArrowRight, PackageOpen, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createPostgresClient } from "@rosegriffon/db/service";
import { formatEuros } from "@/lib/shop/products";
import { getServerUser } from "@/lib/auth-helpers";

export const metadata = {
	robots: { follow: false, index: false },
	title: "Mes commandes · Boutique Rose Griffon",
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

const STATUS_TONE = {
	canceled: "bg-zinc-200 text-zinc-900 border-zinc-400",
	delivered: "bg-emerald-100 text-emerald-900 border-emerald-400",
	failed: "bg-red-200 text-red-900 border-red-500",
	paid: "bg-blue-100 text-blue-900 border-blue-400",
	pending: "bg-yellow-100 text-yellow-900 border-yellow-400",
	refunded: "bg-purple-100 text-purple-900 border-purple-400",
	shipped: "bg-indigo-100 text-indigo-900 border-indigo-400",
} as const;

interface OrderRow {
	id: string;
	stripe_session_id: string;
	amount_total_cents: number;
	patron_discount_applied: boolean;
	status: keyof typeof STATUS_LABEL;
	created_at: string;
	items: { slug?: string; label?: string; qty?: number }[] | null;
}

async function fetchOrders(userId: string): Promise<OrderRow[]> {
	try {
		const { data, error } = await createPostgresClient()
			.from("orders")
			.select(
				"id, stripe_session_id, amount_total_cents, patron_discount_applied, status, created_at, items"
			)
			.eq("user_id", userId)
			.order("created_at", { ascending: false })
			.limit(50);
		if (error) {
			console.warn("[shop/commandes] fetch error", error.message);
			return [];
		}
		return (data ?? []) as OrderRow[];
	} catch (error) {
		console.warn("[shop/commandes] table orders absente ou indisponible:", error);
		return [];
	}
}

export default async function OrdersPage() {
	const user = await getServerUser();
	if (!user) {
		redirect("/login?redirect=/shop/commandes");
	}

	const orders = await fetchOrders(user.id);

	return (
		<div className="mx-auto max-w-5xl px-4 pb-16 pt-10 md:px-8 md:pt-16">
			<header className="mb-10 flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="mb-2 inline-flex items-center gap-2 rounded-full border-2 border-[#d4af37] bg-[#0c1730] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-[#d4af37]">
						<ShoppingBag className="size-3" />
						<span>Boutique Rose Griffon</span>
					</p>
					<h1 className="text-fluid-headline-xl font-extrabold tracking-tight text-white">
						Mes commandes
					</h1>
				</div>
				<Link
					href="/shop"
					className="inline-flex h-10 items-center gap-2 rounded-full bg-[#d4af37] px-5 text-xs font-extrabold uppercase tracking-wider text-[#0c1730] shadow-[0_3px_0_0_rgba(0,0,0,0.5)] transition-transform motion-safe:duration-200 hover:-translate-y-0.5"
				>
					<span>Continuer mes achats</span>
					<ArrowRight className="size-4" />
				</Link>
			</header>

			{orders.length === 0 ? (
				<EmptyOrders />
			) : (
				<ul className="flex flex-col gap-3">
					{orders.map((order) => (
						<li key={order.id}>
							<Link
								href={`/shop/commandes/${order.id}`}
								className="group block overflow-hidden rounded-2xl border-2 border-[#d4af37]/40 bg-[#0c1730]/60 p-5 transition-all motion-safe:duration-200 hover:-translate-y-0.5 hover:border-[#d4af37] hover:bg-[#0c1730]/80"
							>
								<div className="flex flex-wrap items-start justify-between gap-4">
									<div>
										<p className="text-[10px] font-bold uppercase tracking-widest text-[#d4af37]">
											Commande #{order.id.slice(0, 8).toUpperCase()}
										</p>
										<p className="mt-1 text-sm text-white/80">
											{new Date(order.created_at).toLocaleDateString("fr-FR", {
												day: "2-digit",
												hour: "2-digit",
												minute: "2-digit",
												month: "long",
												year: "numeric",
											})}
										</p>
										<p className="mt-2 text-xs text-white/60">
											{order.items?.length ?? 0} article
											{(order.items?.length ?? 0) > 1 ? "s" : ""}
											{order.patron_discount_applied && (
												<span className="ml-2 inline-flex items-center rounded-full bg-[#d4af37]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#d4af37]">
													Patron −20%
												</span>
											)}
										</p>
									</div>
									<div className="flex flex-col items-end gap-2">
										<span
											className={`inline-flex items-center rounded-full border px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE[order.status] ?? STATUS_TONE.pending}`}
										>
											{STATUS_LABEL[order.status] ?? order.status}
										</span>
										<span className="text-2xl font-extrabold text-white">
											{formatEuros(order.amount_total_cents)}
										</span>
									</div>
								</div>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function EmptyOrders() {
	return (
		<div className="grid place-items-center rounded-3xl border-2 border-dashed border-[#d4af37]/40 bg-[#0c1730]/40 px-6 py-20 text-center">
			<PackageOpen className="size-14 text-[#d4af37]" />
			<h2 className="mt-6 text-2xl font-extrabold text-white">Aucune commande pour le moment</h2>
			<p className="mt-2 max-w-md text-sm text-white/70">
				Quand tu auras commandé, tes commandes apparaîtront ici avec le statut d'expédition et le
				suivi.
			</p>
			<Link
				href="/shop"
				className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-[#d4af37] px-5 text-xs font-extrabold uppercase tracking-wider text-[#0c1730] shadow-[0_3px_0_0_rgba(0,0,0,0.5)] hover:-translate-y-0.5 transition-transform motion-safe:duration-200"
			>
				<ShoppingBag className="size-4" />
				Voir le catalogue
			</Link>
		</div>
	);
}
