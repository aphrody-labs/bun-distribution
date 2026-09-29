import { ImageResponse } from "next/og";
import { getTierlistBySlug } from "@/lib/tierlists";

export const alt = "Tierlist Dragon Ball France";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * OG image dynamique d'une tierlist (preview Discord/Twitter au partage).
 * Rendu 100 % stylé, SANS image distante : on représente la structure (barres de
 * tiers colorées + chips = items) → aucun fetch externe ⇒ jamais cassée.
 */
export default async function TierlistOG({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const tl = await getTierlistBySlug(slug).catch(() => null);

	const title = tl?.title ?? "Tierlist Dragon Ball";
	const author = tl?.author?.username ?? "la communauté";
	const tiers = (tl?.tiers ?? []).slice(0, 6);
	const total = tiers.reduce((n, t) => n + t.items.length, 0);

	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				padding: "64px 72px",
				background:
					"radial-gradient(circle at 80% 20%, rgba(255,178,0,0.30), transparent 55%), radial-gradient(circle at 15% 90%, rgba(217,33,33,0.20), transparent 55%), #0a0a0a",
				color: "white",
				fontFamily: "sans-serif",
			}}
		>
			<div
				style={{
					display: "flex",
					fontSize: 26,
					letterSpacing: 8,
					textTransform: "uppercase",
					color: "#e78220",
					fontWeight: 700,
				}}
			>
				Tierlist · Dragon Ball FR
			</div>

			<div
				style={{
					display: "flex",
					fontSize: title.length > 36 ? 56 : 72,
					fontWeight: 800,
					lineHeight: 1.05,
					marginTop: 10,
					maxWidth: 1000,
				}}
			>
				{title}
			</div>

			<div style={{ display: "flex", fontSize: 28, color: "rgba(255,255,255,0.6)", marginTop: 12 }}>
				par {author} · {total} carte{total > 1 ? "s" : ""} classée{total > 1 ? "s" : ""}
			</div>

			{/* Structure des tiers */}
			<div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 34, flex: 1 }}>
				{tiers.map((t) => (
					<div key={t.id} style={{ display: "flex", alignItems: "center", height: 58 }}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 64,
								height: 58,
								borderRadius: 8,
								background: t.color,
								color: "rgba(0,0,0,0.85)",
								fontSize: 30,
								fontWeight: 900,
							}}
						>
							{t.label}
						</div>
						<div style={{ display: "flex", gap: 6, marginLeft: 12, flexWrap: "nowrap" }}>
							{Array.from({ length: Math.min(t.items.length, 16) }).map((_, i) => (
								<div
									key={i}
									style={{
										width: 42,
										height: 42,
										borderRadius: 6,
										background: t.color,
										opacity: 0.42,
									}}
								/>
							))}
						</div>
					</div>
				))}
			</div>

			<div style={{ display: "flex", fontSize: 26, color: "rgba(255,255,255,0.5)" }}>
				dragonballfr.com/tierlists
			</div>
		</div>,
		size
	);
}
