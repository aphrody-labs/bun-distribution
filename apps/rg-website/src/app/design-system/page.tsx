import { PlusIcon, SparklesIcon, StarIcon, ZapIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { ThemeSwitcher } from "./_components/theme-switcher";

const RG_MARINE = "#0c1730";
const RG_OR = "#d4af37";
const RG_BRIQUE = "#a14b3f";
const RG_AZALEE = "#F89C5A";

const M3_COLORS = [
	{ bg: "bg-primary", name: "primary", text: "text-on-primary" },
	{
		bg: "bg-primary-container",
		name: "primary-container",
		text: "text-on-primary-container",
	},
	{ bg: "bg-secondary", name: "secondary", text: "text-on-secondary" },
	{
		bg: "bg-secondary-container",
		name: "secondary-container",
		text: "text-on-secondary-container",
	},
	{ bg: "bg-tertiary", name: "tertiary", text: "text-on-tertiary" },
	{
		bg: "bg-tertiary-container",
		name: "tertiary-container",
		text: "text-on-tertiary-container",
	},
	{ bg: "bg-error", name: "error", text: "text-on-error" },
	{
		bg: "bg-error-container",
		name: "error-container",
		text: "text-on-error-container",
	},
] as const;

const M3_SURFACES = [
	{ bg: "bg-surface-dim", name: "surface-dim" },
	{ bg: "bg-surface", name: "surface" },
	{ bg: "bg-surface-bright", name: "surface-bright" },
	{ bg: "bg-surface-container-lowest", name: "surface-container-lowest" },
	{ bg: "bg-surface-container-low", name: "surface-container-low" },
	{ bg: "bg-surface-container", name: "surface-container" },
	{ bg: "bg-surface-container-high", name: "surface-container-high" },
	{ bg: "bg-surface-container-highest", name: "surface-container-highest" },
] as const;

const TYPESCALE = [
	{ cls: "type-display-large", label: "Display L", spec: "57 / 64" },
	{ cls: "type-display-medium", label: "Display M", spec: "45 / 52" },
	{ cls: "type-display-small", label: "Display S", spec: "36 / 44" },
	{ cls: "type-headline-large", label: "Headline L", spec: "32 / 40" },
	{ cls: "type-headline-medium", label: "Headline M", spec: "28 / 36" },
	{ cls: "type-headline-small", label: "Headline S", spec: "24 / 32" },
	{ cls: "type-title-large", label: "Title L", spec: "22 / 28" },
	{ cls: "type-title-medium", label: "Title M", spec: "16 / 24 · +0.15" },
	{ cls: "type-title-small", label: "Title S", spec: "14 / 20 · +0.1" },
	{ cls: "type-body-large", label: "Body L", spec: "16 / 24 · +0.5" },
	{ cls: "type-body-medium", label: "Body M", spec: "14 / 20 · +0.25" },
	{ cls: "type-body-small", label: "Body S", spec: "12 / 16 · +0.4" },
	{ cls: "type-label-large", label: "Label L", spec: "14 / 20 · +0.1" },
	{ cls: "type-label-medium", label: "Label M", spec: "12 / 16 · +0.5" },
	{ cls: "type-label-small", label: "Label S", spec: "11 / 16 · +0.5" },
];

const SHAPE_SCALE = [
	{ name: "none", value: "0" },
	{ name: "extra-small", value: "4" },
	{ name: "small", value: "8" },
	{ name: "medium", value: "12" },
	{ name: "large", value: "16" },
	{ name: "extra-large", value: "28" },
	{ name: "full", value: "9999" },
];

const MOTION_DURATIONS = [
	{ tier: "short", values: ["50", "100", "150", "200"] },
	{ tier: "medium", values: ["250", "300", "350", "400"] },
	{ tier: "long", values: ["450", "500", "550", "600"] },
	{ tier: "x-long", values: ["700", "800", "900", "1000"] },
];

const ELEVATION_LEVELS = ["0", "1", "2", "3", "4", "5"];

const HARD_SHADOW = "4px 4px 0 0 rgba(0,0,0,0.55)";
const HARD_SHADOW_LG = "6px 6px 0 0 rgba(0,0,0,0.65)";

// Style chunk pour la typo cartoon : outline blanc + drop shadow rouge brique.
// Utilisé sur tous les titres de section pour assurer la cohérence DA.
const cartoonTitleStyle: React.CSSProperties = {
	WebkitTextStroke: "2px #ffffff",
	color: RG_MARINE,
	fontFamily: "var(--font-cartoon-ds), 'Super Cartoon', sans-serif",
	letterSpacing: "0.02em",
	textShadow: `4px 4px 0 ${RG_BRIQUE}, 6px 6px 0 rgba(0,0,0,0.4)`,
};

export default function DesignSystemShowcase() {
	return (
		<div
			data-design-system-root
			className="theme-roy relative isolate overflow-hidden"
			style={{
				backgroundColor: RG_MARINE,
				fontFamily: "var(--font-body-ds), 'Poppins', system-ui, sans-serif",
			}}
		>
			{/* Logo griffon en filigrane sur tout le document */}
			<div
				aria-hidden
				className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center opacity-[0.04]"
			>
				<Image
					src="/RG_Logo_V2.5.webp"
					alt=""
					width={900}
					height={900}
					priority={false}
					sizes="900px"
					className="select-none"
				/>
			</div>

			{/* ────────────────────────────────────────────── HERO */}
			<section
				className="relative z-10 mx-auto grid min-h-[92svh] max-w-[1440px] grid-cols-12 gap-6 px-6 pt-10 pb-24 md:px-12"
				style={{ backgroundColor: RG_MARINE }}
			>
				{/* Arc diagonal or en fond du hero */}
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 z-0"
					style={{
						background: `radial-gradient(ellipse 90% 60% at 20% 10%, ${RG_BRIQUE}30 0%, transparent 60%), radial-gradient(ellipse 70% 50% at 90% 90%, ${RG_OR}25 0%, transparent 55%)`,
					}}
				/>

				<header className="relative z-20 col-span-12 flex items-start justify-between gap-6 pb-12">
					<div
						className="text-[11px] uppercase tracking-[0.32em]"
						style={{
							color: RG_OR,
							fontFamily: "var(--font-cartoon-ds), sans-serif",
						}}
					>
						<span className="block">@rosegriffon/ui</span>
						<span className="block">Design System · v0.1.0</span>
					</div>
					<ThemeSwitcher />
				</header>

				<div className="relative z-20 col-span-12 grid grid-cols-12 gap-6">
					<div className="col-span-12 lg:col-span-8">
						<p
							className="mb-8 inline-flex items-center gap-3 rounded-full border-2 px-4 py-1.5 text-[11px] uppercase tracking-[0.28em]"
							style={{
								backgroundColor: "rgba(212,175,55,0.08)",
								borderColor: RG_OR,
								boxShadow: HARD_SHADOW,
								color: RG_OR,
								fontFamily: "var(--font-cartoon-ds), sans-serif",
							}}
						>
							<ZapIcon className="size-3" aria-hidden />
							<span>Inazuma × Material Design 3 · 55 composants</span>
						</p>
						<h1
							className="text-fluid-display-2xl leading-[0.9] text-balance"
							style={{
								...cartoonTitleStyle,
								WebkitTextStroke: `3px ${RG_MARINE}`,
								color: "#fffdf5",
								textShadow: `5px 5px 0 ${RG_BRIQUE}, 8px 8px 0 rgba(0,0,0,0.5)`,
								transform: "rotate(-2deg)",
								transformOrigin: "left bottom",
							}}
						>
							ROSE
							<br />
							GRIFFON
							<span
								style={{
									color: RG_OR,
									display: "inline-block",
									marginLeft: "0.3em",
								}}
							>
								×
							</span>
							<br />
							SYSTEM
						</h1>
					</div>

					<aside className="col-span-12 mt-10 flex flex-col gap-6 self-end lg:col-span-4 lg:mt-0">
						<div className="relative mx-auto h-[200px] w-[200px] md:h-[260px] md:w-[260px] motion-safe:animate-pulse">
							<Image
								src="/emote.webp"
								alt="Mascotte chibi Rose Griffon"
								fill
								sizes="(max-width: 768px) 200px, 260px"
								className="object-contain drop-shadow-[6px_6px_0_rgba(0,0,0,0.55)]"
								priority
							/>
						</div>
						<p className="text-fluid-body-lg leading-relaxed" style={{ color: "#f5e9d4" }}>
							Catalogue vivant des 55 composants{" "}
							<strong style={{ color: RG_OR }}>@rosegriffon/ui</strong>, palette{" "}
							<strong style={{ color: RG_OR }}>MD3</strong> et 4 thèmes — Roy, Gaëlle, Azalée light
							& dark.
						</p>
						<dl className="grid grid-cols-3 gap-3 border-t-2 pt-6" style={{ borderColor: RG_OR }}>
							{[
								{ k: "Composants", v: "58" },
								{ k: "Tokens", v: "212" },
								{ k: "Thèmes", v: "4" },
							].map((stat) => (
								<div key={stat.k}>
									<dd
										className="text-fluid-headline-xl leading-none"
										style={{
											WebkitTextStroke: "1.5px #fffdf5",
											color: RG_OR,
											fontFamily: "var(--font-cartoon-ds), sans-serif",
											textShadow: `3px 3px 0 ${RG_BRIQUE}`,
										}}
									>
										{stat.v}
									</dd>
									<dt
										className="mt-1 text-[10px] uppercase tracking-[0.22em]"
										style={{ color: "#f5e9d4" }}
									>
										{stat.k}
									</dt>
								</div>
							))}
						</dl>
					</aside>
				</div>

				<a
					href="#palette"
					className="relative z-20 col-span-12 mt-12 inline-flex items-center gap-3 self-end text-[11px] uppercase tracking-[0.28em] transition-transform motion-safe:duration-200 hover:translate-y-1"
					style={{
						color: RG_OR,
						fontFamily: "var(--font-cartoon-ds), sans-serif",
					}}
				>
					<span>★ Scroll · Système ★</span>
				</a>
			</section>

			{/* ────────────────────────────────────────────── PALETTE */}
			<section
				id="palette"
				className="relative z-10 overflow-hidden"
				style={{
					backgroundColor: "#3a1a1a",
					borderTop: `2px solid ${RG_OR}`,
				}}
			>
				{/* Arc diagonal or en fond */}
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0"
					style={{
						background: `linear-gradient(135deg, transparent 0%, transparent 55%, ${RG_OR}15 55%, ${RG_OR}15 58%, transparent 58%)`,
					}}
				/>
				<div className="relative mx-auto max-w-[1440px] px-6 py-24 md:px-12">
					{/* Trading card Roy en haut à droite */}
					<div
						className="pointer-events-none absolute top-8 right-4 z-20 hidden h-[180px] w-[120px] md:right-12 md:block md:h-[220px] md:w-[150px]"
						style={{
							filter: "drop-shadow(6px 6px 0 rgba(0,0,0,0.6))",
							transform: "rotate(8deg)",
						}}
					>
						<Image
							src="/RG_roy_LC.webp"
							alt="Trading card Roy"
							fill
							sizes="(max-width: 768px) 0px, 150px"
							className="object-contain"
						/>
					</div>

					<SectionLabel kicker="01 · Color" title="★ PALETTE ★" />

					<div className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{M3_COLORS.map((c) => (
							<div
								key={c.name}
								className={`${c.bg} ${c.text} group flex aspect-[5/3] flex-col justify-between p-5 rounded-[12px]`}
								style={{
									border: `2px solid ${RG_OR}`,
									boxShadow: HARD_SHADOW,
								}}
							>
								<span
									className="text-[10px] uppercase tracking-[0.18em] opacity-90"
									style={{ fontFamily: "var(--font-cartoon-ds), sans-serif" }}
								>
									{c.name}
								</span>
								<span
									className="text-fluid-headline-xl leading-[0.9]"
									style={{
										WebkitTextStroke: "1.5px currentColor",
										fontFamily: "var(--font-cartoon-ds), sans-serif",
									}}
								>
									Aa
								</span>
							</div>
						))}
					</div>

					<h3
						className="mt-20 mb-6 text-[12px] uppercase tracking-[0.24em]"
						style={{
							color: RG_OR,
							fontFamily: "var(--font-cartoon-ds), sans-serif",
						}}
					>
						Surface tonal stack · MD3
					</h3>
					<div
						className="grid grid-cols-2 gap-0 overflow-hidden md:grid-cols-4 lg:grid-cols-8 rounded-[12px]"
						style={{
							border: `2px solid ${RG_OR}`,
							boxShadow: HARD_SHADOW,
						}}
					>
						{M3_SURFACES.map((s) => (
							<div
								key={s.name}
								className={`${s.bg} flex aspect-square flex-col items-center justify-center p-3 text-center text-on-surface`}
							>
								<span
									className="text-[9px] uppercase tracking-[0.16em] opacity-80"
									style={{ fontFamily: "var(--font-cartoon-ds), sans-serif" }}
								>
									{s.name.replace("surface-", "") || "default"}
								</span>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* ────────────────────────────────────────────── TYPESCALE */}
			<section
				className="relative z-10"
				style={{ backgroundColor: RG_MARINE, borderTop: `2px solid ${RG_OR}` }}
			>
				<div className="mx-auto max-w-[1440px] px-6 py-24 md:px-12">
					<SectionLabel kicker="02 · Type" title="TYPOGRAPHIE" />

					{/* Phrase test cartoon */}
					<div className="mt-12 mb-10 text-center">
						<p
							className="text-fluid-display-xl leading-[0.95]"
							style={{
								...cartoonTitleStyle,
								WebkitTextStroke: `3px ${RG_MARINE}`,
								color: "#fffdf5",
								display: "inline-block",
								textShadow: `5px 5px 0 ${RG_BRIQUE}, 8px 8px 0 rgba(0,0,0,0.5)`,
								transform: "rotate(-1deg)",
							}}
						>
							Quelle est ta couleur ?
						</p>
					</div>

					<ul
						className="mt-12 divide-y rounded-[16px]"
						style={{
							backgroundColor: "rgba(255,253,245,0.03)",
							borderColor: RG_OR,
							borderStyle: "solid",
							borderWidth: "2px",
							boxShadow: HARD_SHADOW,
						}}
					>
						{TYPESCALE.map((t) => (
							<li
								key={t.cls}
								className="group grid grid-cols-12 items-baseline gap-4 px-5 py-4 transition-colors motion-safe:duration-200 hover:bg-white/5"
								style={{ borderColor: `${RG_OR}40` }}
							>
								<span
									className={`${t.cls} col-span-12 truncate md:col-span-7`}
									style={{ color: "#fffdf5" }}
								>
									Quelle est ta couleur ?
								</span>
								<span
									className="col-span-6 text-[11px] uppercase tracking-[0.18em] md:col-span-3"
									style={{
										color: RG_OR,
										fontFamily: "var(--font-cartoon-ds), sans-serif",
									}}
								>
									{t.label}
								</span>
								<span
									className="col-span-6 text-right text-[10px] md:col-span-2"
									style={{ color: "#f5e9d4", fontFamily: "monospace" }}
								>
									{t.spec}
								</span>
							</li>
						))}
					</ul>
				</div>
			</section>

			{/* ────────────────────────────────────────────── COMPONENTS */}
			<section
				className="relative z-10 overflow-hidden"
				style={{
					backgroundColor: "#1a2447",
					borderTop: `2px solid ${RG_OR}`,
				}}
			>
				<div className="mx-auto grid max-w-[1440px] grid-cols-12 gap-6 px-6 py-24 md:px-12">
					<div className="col-span-12 mb-12">
						<SectionLabel kicker="03 · Components" title="COMPOSANTS RG" />
					</div>

					<div className="col-span-12 grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-3">
						<ComponentTile title="Filled · OR">
							<button
								type="button"
								className="inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-[13px] font-semibold uppercase tracking-wider transition-transform motion-safe:duration-200 hover:-translate-y-0.5"
								style={{
									backgroundColor: RG_OR,
									boxShadow: HARD_SHADOW,
									color: RG_MARINE,
									fontFamily: "var(--font-cartoon-ds), sans-serif",
								}}
							>
								<PlusIcon className="size-4" aria-hidden /> Nouvelle action
							</button>
						</ComponentTile>

						<ComponentTile title="Tonal · BRIQUE">
							<button
								type="button"
								className="inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-[13px] font-semibold uppercase tracking-wider transition-transform motion-safe:duration-200 hover:-translate-y-0.5"
								style={{
									backgroundColor: RG_BRIQUE,
									boxShadow: HARD_SHADOW,
									color: "#fffdf5",
									fontFamily: "var(--font-cartoon-ds), sans-serif",
								}}
							>
								Tonal
							</button>
						</ComponentTile>

						<ComponentTile title="Outlined · MARINE">
							<button
								type="button"
								className="inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-[13px] font-semibold uppercase tracking-wider transition-transform motion-safe:duration-200 hover:-translate-y-0.5"
								style={{
									backgroundColor: "transparent",
									border: `2px solid ${RG_OR}`,
									boxShadow: HARD_SHADOW,
									color: RG_OR,
									fontFamily: "var(--font-cartoon-ds), sans-serif",
								}}
							>
								Outlined
							</button>
						</ComponentTile>

						<ComponentTile title="FAB · Azalée">
							<button
								type="button"
								aria-label="Ajouter"
								className="grid size-14 place-items-center rounded-full transition-transform motion-safe:duration-200 hover:rotate-90"
								style={{
									backgroundColor: RG_AZALEE,
									border: `2px solid ${RG_OR}`,
									boxShadow: HARD_SHADOW_LG,
									color: RG_MARINE,
								}}
							>
								<PlusIcon className="size-6" aria-hidden />
							</button>
						</ComponentTile>

						<ComponentTile title="FAB Extended">
							<button
								type="button"
								className="inline-flex h-14 items-center gap-3 rounded-full px-5 text-[14px] font-semibold uppercase tracking-wider transition-transform motion-safe:duration-200 hover:-translate-y-1"
								style={{
									backgroundColor: RG_OR,
									border: `2px solid ${RG_MARINE}`,
									boxShadow: HARD_SHADOW_LG,
									color: RG_MARINE,
									fontFamily: "var(--font-cartoon-ds), sans-serif",
								}}
							>
								<SparklesIcon className="size-5" aria-hidden /> Composer
							</button>
						</ComponentTile>

						<ComponentTile title="Badges PATRON">
							<div
								className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.12em]"
								style={{ fontFamily: "var(--font-cartoon-ds), sans-serif" }}
							>
								<span
									className="inline-flex items-center gap-1 rounded-full px-2.5 py-1"
									style={{
										backgroundColor: RG_OR,
										border: `1.5px solid ${RG_MARINE}`,
										boxShadow: "2px 2px 0 0 rgba(0,0,0,0.5)",
										color: RG_MARINE,
									}}
								>
									<StarIcon className="size-3" aria-hidden /> Patron
								</span>
								<span
									className="rounded-full px-2.5 py-1"
									style={{
										backgroundColor: RG_BRIQUE,
										border: `1.5px solid ${RG_OR}`,
										boxShadow: "2px 2px 0 0 rgba(0,0,0,0.5)",
										color: "#fffdf5",
									}}
								>
									Roy
								</span>
								<span
									className="rounded-full px-2.5 py-1"
									style={{
										backgroundColor: RG_AZALEE,
										border: `1.5px solid ${RG_OR}`,
										boxShadow: "2px 2px 0 0 rgba(0,0,0,0.5)",
										color: RG_MARINE,
									}}
								>
									Azalée
								</span>
								<span
									className="rounded-full px-2.5 py-1"
									style={{
										backgroundColor: "transparent",
										border: `1.5px solid ${RG_OR}`,
										color: RG_OR,
									}}
								>
									IEVR
								</span>
							</div>
						</ComponentTile>
					</div>

					{/* Cards persos avec mascots */}
					<div className="col-span-12 mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
						{[
							{ asset: "/RG_roy_LC.webp", name: "Roy", tint: RG_BRIQUE },
							{ asset: "/RG_gaelle_LC.webp", name: "Gaëlle", tint: RG_OR },
							{
								asset: "/RG_Azalee-logo.webp",
								name: "Azalée",
								tint: RG_AZALEE,
							},
						].map((card, i) => (
							<article
								key={card.name}
								className="group relative overflow-hidden rounded-[16px] p-6 transition-transform motion-safe:duration-300 hover:-translate-y-2"
								style={{
									backgroundColor: RG_MARINE,
									border: `2px solid ${RG_OR}`,
									boxShadow: HARD_SHADOW_LG,
								}}
							>
								<header className="mb-3 flex items-center justify-between">
									<span
										className="text-[10px] uppercase tracking-[0.2em]"
										style={{
											color: RG_OR,
											fontFamily: "var(--font-cartoon-ds), sans-serif",
										}}
									>
										Card · elev {i + 1}
									</span>
									<span
										className="grid size-8 place-items-center rounded-full"
										style={{
											backgroundColor: card.tint,
											border: `1.5px solid ${RG_OR}`,
											color: "#fffdf5",
										}}
									>
										<StarIcon className="size-4" aria-hidden />
									</span>
								</header>
								<div className="relative mt-2 mb-4 h-[140px] w-full">
									<Image
										src={card.asset}
										alt={`Mascotte ${card.name}`}
										fill
										sizes="(max-width: 768px) 100vw, 33vw"
										className="object-contain transition-transform motion-safe:duration-300 group-hover:scale-110"
									/>
								</div>
								<h4
									className="text-fluid-headline-lg leading-tight"
									style={{
										WebkitTextStroke: `1.5px ${RG_MARINE}`,
										color: "#fffdf5",
										fontFamily: "var(--font-cartoon-ds), sans-serif",
										textShadow: `3px 3px 0 ${card.tint}`,
									}}
								>
									{card.name}
								</h4>
								<p className="mt-2 text-[13px]" style={{ color: "#f5e9d4" }}>
									Container low · elevation niveau {i + 1} · token MD3.
								</p>
							</article>
						))}
					</div>
				</div>
			</section>

			{/* ────────────────────────────────────────────── SHAPE */}
			<section
				className="relative z-10"
				style={{ backgroundColor: RG_MARINE, borderTop: `2px solid ${RG_OR}` }}
			>
				<div className="mx-auto max-w-[1440px] px-6 py-24 md:px-12">
					<SectionLabel kicker="04 · Shape" title="CORNER SCALE" />
					<div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
						{SHAPE_SCALE.map((s) => (
							<div key={s.name} className="group flex flex-col items-center gap-3">
								<div
									className="grid aspect-square w-full place-items-center transition-transform motion-safe:duration-200 group-hover:-translate-y-1 group-hover:rotate-3"
									style={{
										backgroundColor: RG_OR,
										border: `2px solid ${RG_MARINE}`,
										borderRadius: s.name === "full" ? "9999px" : `${s.value}px`,
										boxShadow: HARD_SHADOW,
										color: RG_MARINE,
									}}
								>
									<span
										className="text-[28px]"
										style={{
											WebkitTextStroke: `1.5px ${RG_MARINE}`,
											fontFamily: "var(--font-cartoon-ds), sans-serif",
											textShadow: `2px 2px 0 ${RG_BRIQUE}`,
										}}
									>
										{s.value === "9999" ? "∞" : s.value}
									</span>
								</div>
								<span
									className="text-center text-[10px] uppercase tracking-[0.16em]"
									style={{
										color: RG_OR,
										fontFamily: "var(--font-cartoon-ds), sans-serif",
									}}
								>
									{s.name}
								</span>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* ────────────────────────────────────────────── MOTION */}
			<section
				className="relative z-10"
				style={{
					backgroundColor: "#1a2447",
					borderTop: `2px solid ${RG_OR}`,
				}}
			>
				<div className="mx-auto max-w-[1440px] px-6 py-24 md:px-12">
					<SectionLabel kicker="05 · Motion" title="MOTION TOKENS" />

					<div className="mt-12 grid gap-10 lg:grid-cols-2">
						<div>
							<h3
								className="mb-6 text-[12px] uppercase tracking-[0.22em]"
								style={{
									color: RG_OR,
									fontFamily: "var(--font-cartoon-ds), sans-serif",
								}}
							>
								★ Durations
							</h3>
							<div className="space-y-2">
								{MOTION_DURATIONS.map((row) => (
									<div
										key={row.tier}
										className="flex items-center gap-3 text-[11px]"
										style={{ fontFamily: "var(--font-cartoon-ds), sans-serif" }}
									>
										<span className="w-20 uppercase tracking-[0.16em]" style={{ color: RG_OR }}>
											{row.tier}
										</span>
										{row.values.map((ms) => (
											<span
												key={ms}
												className="flex-1 rounded-md px-2 py-3 text-center"
												style={{
													backgroundColor: RG_BRIQUE,
													border: `1.5px solid ${RG_OR}`,
													boxShadow: "2px 2px 0 0 rgba(0,0,0,0.5)",
													color: "#fffdf5",
												}}
											>
												{ms}ms
											</span>
										))}
									</div>
								))}
							</div>
						</div>

						<div>
							<h3
								className="mb-6 text-[12px] uppercase tracking-[0.22em]"
								style={{
									color: RG_OR,
									fontFamily: "var(--font-cartoon-ds), sans-serif",
								}}
							>
								★ Easings · live preview
							</h3>
							<div className="space-y-3 text-[11px]">
								{[
									{
										curve: "cubic-bezier(.2,0,0,1)",
										dur: "var(--md-sys-motion-duration-medium2)",
										name: "standard",
									},
									{
										curve: "cubic-bezier(.3,0,0,1)",
										dur: "var(--md-sys-motion-duration-medium4)",
										name: "emphasized",
									},
									{
										curve: "cubic-bezier(0,0,0,1)",
										dur: "var(--md-sys-motion-duration-long1)",
										name: "standard-decel",
									},
									{
										curve: "cubic-bezier(.05,.7,.1,1)",
										dur: "var(--md-sys-motion-duration-long2)",
										name: "emphasized-decel",
									},
								].map((e) => (
									<div
										key={e.name}
										className="group relative flex items-center justify-between overflow-hidden rounded-md px-4 py-3"
										style={{
											backgroundColor: RG_MARINE,
											border: `2px solid ${RG_OR}`,
											boxShadow: "3px 3px 0 0 rgba(0,0,0,0.55)",
										}}
									>
										<div className="flex flex-col" style={{ color: "#fffdf5" }}>
											<span
												className="uppercase tracking-[0.18em]"
												style={{
													color: RG_OR,
													fontFamily: "var(--font-cartoon-ds), sans-serif",
												}}
											>
												{e.name}
											</span>
											<span style={{ color: "#f5e9d4", fontFamily: "monospace" }}>{e.curve}</span>
										</div>
										<span
											className="block size-4 rounded-full motion-safe:group-hover:translate-x-24"
											style={{
												backgroundColor: RG_AZALEE,
												border: `1.5px solid ${RG_OR}`,
												transitionDuration: e.dur,
												transitionProperty: "transform",
												transitionTimingFunction: e.curve,
											}}
										/>
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* ────────────────────────────────────────────── ELEVATION */}
			<section
				className="relative z-10"
				style={{ backgroundColor: RG_MARINE, borderTop: `2px solid ${RG_OR}` }}
			>
				<div className="mx-auto max-w-[1440px] px-6 py-24 md:px-12">
					<SectionLabel kicker="06 · Elevation" title="6 LEVELS" />
					<div className="mt-12 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
						{ELEVATION_LEVELS.map((lvl, i) => (
							<div key={lvl} className="flex flex-col items-center gap-4">
								<div
									className="grid size-24 place-items-center rounded-[12px] transition-transform motion-safe:duration-300 hover:-translate-y-2"
									style={{
										backgroundColor: RG_OR,
										border: `2px solid ${RG_MARINE}`,
										boxShadow:
											i === 0
												? "none"
												: `${i + 1}px ${i + 1}px 0 0 rgba(0,0,0,0.55), ${(i + 1) * 2}px ${(i + 1) * 2}px 0 0 ${RG_BRIQUE}`,
										color: RG_MARINE,
									}}
								>
									<span
										className="text-[28px]"
										style={{
											WebkitTextStroke: `1.5px ${RG_MARINE}`,
											fontFamily: "var(--font-cartoon-ds), sans-serif",
										}}
									>
										{lvl}
									</span>
								</div>
								<span
									className="text-[10px] uppercase tracking-[0.18em]"
									style={{
										color: RG_OR,
										fontFamily: "var(--font-cartoon-ds), sans-serif",
									}}
								>
									level{lvl}
								</span>
							</div>
						))}
					</div>

					{/* Bandeau tuto avatars en bonus */}
					<div
						className="mt-20 grid grid-cols-1 items-center gap-8 rounded-[20px] p-8 md:grid-cols-[1fr_2fr]"
						style={{
							backgroundColor: "#1a2447",
							border: `2px solid ${RG_OR}`,
							boxShadow: HARD_SHADOW_LG,
						}}
					>
						<div className="relative aspect-[4/3] w-full">
							<Image
								src="/avatarRG/avatarRG.webp"
								alt="Tutoriel avatars chibi Rose Griffon"
								fill
								sizes="(max-width: 768px) 100vw, 33vw"
								className="rounded-[12px] object-cover"
								style={{ border: `2px solid ${RG_BRIQUE}` }}
							/>
						</div>
						<div>
							<p
								className="text-fluid-headline-md leading-tight"
								style={{
									WebkitTextStroke: `1.5px ${RG_MARINE}`,
									color: "#fffdf5",
									fontFamily: "var(--font-cartoon-ds), sans-serif",
									textShadow: `3px 3px 0 ${RG_BRIQUE}`,
								}}
							>
								Avatars chibi · style maison
							</p>
							<p className="mt-3 text-fluid-body-md" style={{ color: "#f5e9d4" }}>
								Toute l&apos;identité RG repose sur des mascots illustrés à la main (Roy, Gaëlle,
								Mark, Achillea…). Le design system étend ce langage aux composants : bordures dorées
								2px, dropshadows durs, palette marine / or / brique.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* ────────────────────────────────────────────── FOOTER */}
			<footer
				className="relative z-10"
				style={{ backgroundColor: "#080f24", borderTop: `2px solid ${RG_OR}` }}
			>
				<div className="mx-auto max-w-[1440px] px-6 py-16 md:px-12">
					<div className="flex flex-col items-center gap-8 text-center">
						<Link
							href="https://rose-griffon.fr"
							className="relative block size-24 transition-transform motion-safe:duration-500 hover:rotate-[360deg] md:size-32"
						>
							<Image
								src="/RG_Logo_V2.5.webp"
								alt="Logo Rose Griffon"
								fill
								sizes="(max-width: 768px) 96px, 128px"
								className="drop-shadow-[4px_4px_0_rgba(212,175,55,0.6)]"
							/>
						</Link>
						<p
							className="text-fluid-headline-md leading-tight"
							style={{
								WebkitTextStroke: `2px ${RG_MARINE}`,
								color: "#fffdf5",
								fontFamily: "var(--font-cartoon-ds), sans-serif",
								textShadow: `4px 4px 0 ${RG_BRIQUE}, 6px 6px 0 rgba(0,0,0,0.4)`,
							}}
						>
							ASSOCIATION ROSE GRIFFON
							<br />
							<span style={{ color: RG_OR }}>· INAZUMA ELEVEN FRANCE ·</span>
						</p>
						<dl
							className="grid grid-cols-2 gap-4 text-[11px] uppercase tracking-[0.18em] md:grid-cols-4"
							style={{
								color: "#f5e9d4",
								fontFamily: "var(--font-cartoon-ds), sans-serif",
							}}
						>
							<div>
								<dt className="block opacity-60">Package</dt>
								<dd style={{ color: RG_OR }}>@rosegriffon/ui</dd>
							</div>
							<div>
								<dt className="block opacity-60">Version</dt>
								<dd style={{ color: RG_OR }}>0.1.0</dd>
							</div>
							<div>
								<dt className="block opacity-60">Stack</dt>
								<dd style={{ color: RG_OR }}>Tailwind · MD3</dd>
							</div>
							<div>
								<dt className="block opacity-60">Docs</dt>
								<dd>
									<Link
										href="https://github.com/rose-griffon/rg/blob/main/packages/ui/README.md"
										style={{ color: RG_OR }}
										className="underline-offset-4 hover:underline"
									>
										README
									</Link>
								</dd>
							</div>
						</dl>
					</div>
				</div>
			</footer>
		</div>
	);
}

function SectionLabel({ kicker, title }: { kicker: string; title: string }) {
	return (
		<div className="grid grid-cols-12 items-end gap-6">
			<span
				className="col-span-12 text-[11px] uppercase tracking-[0.32em] md:col-span-3"
				style={{
					color: RG_OR,
					fontFamily: "var(--font-cartoon-ds), sans-serif",
				}}
			>
				{kicker}
			</span>
			<h2
				className="col-span-12 text-fluid-display-lg leading-[0.95] md:col-span-9"
				style={{
					...cartoonTitleStyle,
					WebkitTextStroke: `3px ${RG_MARINE}`,
					color: "#fffdf5",
					display: "inline-block",
					textShadow: `4px 4px 0 ${RG_BRIQUE}, 6px 6px 0 rgba(0,0,0,0.45)`,
					transform: "rotate(-1deg)",
					transformOrigin: "left",
				}}
			>
				{title}
			</h2>
		</div>
	);
}

function ComponentTile({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-4">
			<span
				className="text-[11px] uppercase tracking-[0.22em]"
				style={{
					color: RG_OR,
					fontFamily: "var(--font-cartoon-ds), sans-serif",
				}}
			>
				{title}
			</span>
			<div
				className="grid min-h-[140px] place-items-center rounded-[16px] p-8"
				style={{
					backgroundColor: "rgba(255,253,245,0.04)",
					border: `2px solid ${RG_OR}`,
					boxShadow: HARD_SHADOW,
				}}
			>
				{children}
			</div>
		</div>
	);
}
