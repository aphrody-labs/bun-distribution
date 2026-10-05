/**
 * KintoUn — le nuage magique en SVG pur (0 JS, server-safe), même géométrie que
 * `public/dbz/kinto-un.svg` et que les favicons (`src/lib/kinto-un.ts`).
 *
 * Deux variantes :
 *  - `illustration` (défaut) : 1200 × 648, queue fuselée — header, décor, loaders ;
 *  - `icone` : carré 512 sur pastille sombre — quand il faut un repère carré.
 */
import { KINTO_UN_ICONE, KINTO_UN_ILLUSTRATION, corpsIcone, corpsNuage } from "../toriyama-svg/kinto-un";

export function KintoUn({
	variante = "illustration",
	hauteur = 32,
	className,
	title,
	decorative = false,
}: {
	variante?: "illustration" | "icone";
	/** Hauteur rendue en px ; la largeur suit le ratio du dessin. */
	hauteur?: number;
	className?: string;
	title?: string;
	decorative?: boolean;
}) {
	const n = variante === "icone" ? KINTO_UN_ICONE : KINTO_UN_ILLUSTRATION;
	const largeur = Math.round((hauteur * n.largeur) / n.hauteur);
	// Les ids de dégradés diffèrent par variante (`kt-*` / `kti-*`) : deux nuages
	// sur la même page ne se volent pas leur `clipPath`, global au document.
	const corps = variante === "icone" ? corpsIcone() : corpsNuage(n, "kt");
	const a11y = decorative
		? { "aria-hidden": true as const }
		: { role: "img" as const, "aria-label": title ?? "Kinto-Un, le nuage magique" };
	return (
		<svg
			viewBox={`0 0 ${n.largeur} ${n.hauteur}`}
			width={largeur}
			height={hauteur}
			className={className}
			{...a11y}
			// Le corps est une chaîne générée par notre propre code, sans donnée
			// externe : aucune entrée utilisateur n'y transite.
			dangerouslySetInnerHTML={{ __html: corps }}
		/>
	);
}

/**
 * Loader : le Kinto-un file vers la droite — un léger tangage, deux traînées
 * de vitesse qui défilent derrière lui. Région live par défaut (`role="status"`),
 * `decorative` dans un contrôle déjà nommé.
 */
export function KintoUnLoader({
	size = 40,
	className = "",
	decorative = false,
}: {
	/** Hauteur du nuage en px. */
	size?: number;
	className?: string;
	decorative?: boolean;
}) {
	const largeur = Math.round(size * 1.85);
	const trait = Math.max(1.5, size / 14);
	return (
		<span
			className={`kt-loader inline-flex items-center ${className}`}
			style={{ width: largeur + size * 0.9, height: size * 1.4 }}
			{...(decorative ? { "aria-hidden": true } : { "aria-label": "Chargement", role: "status" })}
		>
			<svg
				viewBox="0 0 40 20"
				width={size * 0.9}
				height={size * 0.45}
				aria-hidden
				className="kt-trainees shrink-0"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth={trait}
				style={{ color: "rgba(255,178,0,0.55)" }}
			>
				<path className="kt-t1" d="M6 5h30" />
				<path className="kt-t2" d="M14 12h22" />
				<path className="kt-t3" d="M2 17h26" />
			</svg>
			<span className="kt-nuage inline-block" style={{ width: largeur, height: size }}>
				<KintoUn hauteur={size} decorative />
			</span>
			<style>{`
.kt-nuage{animation:kt-tangage 1.3s ease-in-out infinite;transform-origin:50% 60%}
@keyframes kt-tangage{0%,100%{transform:translateY(-6%) rotate(-2deg)}50%{transform:translateY(6%) rotate(2deg)}}
.kt-trainees path{stroke-dasharray:14 26;animation:kt-file .9s linear infinite}
.kt-trainees .kt-t2{animation-delay:-.3s}.kt-trainees .kt-t3{animation-delay:-.6s}
@keyframes kt-file{to{stroke-dashoffset:-40}}
@media (prefers-reduced-motion:reduce){.kt-nuage,.kt-trainees path{animation:none!important}}
`}</style>
		</span>
	);
}
