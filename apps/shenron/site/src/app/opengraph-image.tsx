import { ImageResponse } from "next/og";
import { svgIllustration } from "@/lib/kinto-un";

export const alt = "Dragon Ball France — le portail francophone";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * OG image de marque par défaut (1200×630), générée à la volée par `next/og`.
 * Héritée par toutes les routes qui ne définissent pas leur propre image OG.
 * Styles inline uniquement, police système (latin) → aucun fetch externe.
 *
 * Le wordmark reprend le logo des couvertures : capitales très grasses portant
 * le dégradé bleu mesuré sur les tankōbon, cernées d'un liseré clair. Satori ne
 * connaît pas `-webkit-text-stroke` — le liseré est donc composé en huit ombres
 * portées de rayon nul, ce qui donne le même contour à cette taille.
 */
const LOGO = { haut: "#176285", milieu: "#1f9ec8", bas: "#52c5ef" } as const;
const OS = "#efe9d8";

const contour = (r: number, couleur: string) =>
	[
		[r, 0],
		[-r, 0],
		[0, r],
		[0, -r],
		[r, r],
		[-r, -r],
		[r, -r],
		[-r, r],
	]
		.map(([x, y]) => `${x}px ${y}px 0 ${couleur}`)
		.join(", ");

export default function OpengraphImage() {
	// Le Kinto-Un est passé en image encodée : Satori accepte un SVG en URL de
	// données et le rend tel quel, ce qui évite de redessiner la géométrie ici.
	const nuage = `data:image/svg+xml;base64,${Buffer.from(svgIllustration()).toString("base64")}`;
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "center",
				padding: "80px",
				background:
					"radial-gradient(circle at 78% 26%, rgba(82,197,239,0.22), transparent 55%), radial-gradient(circle at 18% 88%, rgba(255,178,0,0.16), transparent 55%), #0a0a0a",
				color: "white",
				fontFamily: "sans-serif",
			}}
		>
			{/* Le nuage, en filigrane haut-droite : c'est le repère de marque du site
			    (barre, favicons, chargements), il doit être sur la carte de partage. */}
			<img
				src={nuage}
				width={520}
				height={293}
				alt=""
				style={{ position: "absolute", top: 54, right: -40, opacity: 0.5 }}
			/>

			<div
				style={{
					display: "flex",
					fontSize: 28,
					letterSpacing: 8,
					textTransform: "uppercase",
					color: "#e78220",
					fontWeight: 700,
					marginBottom: 22,
				}}
			>
				Le portail francophone
			</div>

			<div
				style={{
					display: "flex",
					fontSize: 118,
					fontWeight: 900,
					lineHeight: 1,
					letterSpacing: -4,
					textTransform: "uppercase",
					backgroundImage: `linear-gradient(180deg, ${LOGO.haut} 0%, ${LOGO.milieu} 54%, ${LOGO.bas} 100%)`,
					backgroundClip: "text",
					color: "transparent",
					textShadow: contour(5, OS),
				}}
			>
				Dragon Ball
			</div>
			<div
				style={{
					display: "flex",
					marginTop: 14,
					fontSize: 44,
					fontWeight: 800,
					letterSpacing: 18,
					textTransform: "uppercase",
					color: LOGO.bas,
				}}
			>
				France
			</div>

			<div
				style={{
					display: "flex",
					marginTop: 36,
					fontSize: 32,
					color: "rgba(255,255,255,0.82)",
					maxWidth: 760,
				}}
			>
				Épisodes, films, manga &amp; actualités — l&apos;univers Dragon Ball en français.
			</div>
			<div
				style={{
					display: "flex",
					marginTop: "auto",
					fontSize: 26,
					color: "rgba(255,255,255,0.5)",
					letterSpacing: 2,
				}}
			>
				dragonballfr.com
			</div>
		</div>,
		size
	);
}
