"use client";

/**
 * Briques d'interface du module d'édition : bouton d'outil, groupe, panneau
 * ancré et feuille mobile.
 *
 * Trois règles tiennent tout le reste :
 *   1. **mobile d'abord** — cibles tactiles ≥ 44 px, panneaux qui deviennent des
 *      feuilles glissantes en bas d'écran sous 768 px ;
 *   2. **le focus ne quitte jamais le texte** — `onMouseDown` annulé sur chaque
 *      bouton, sinon la sélection est perdue avant que la commande s'applique ;
 *   3. **accessible** — `aria-pressed` sur les bascules, piège de focus et
 *      restitution sur les panneaux modaux.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Croix } from "@/components/icones";

import { useFocusTrap } from "@/lib/use-focus-trap";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Boutons                                                                    */
/* -------------------------------------------------------------------------- */

export function ToolButton({
	icon: Icon,
	label,
	active,
	disabled,
	onClick,
	compact,
	showLabel,
	className,
}: {
	icon?: React.ComponentType<{ className?: string }>;
	label: string;
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	compact?: boolean;
	showLabel?: boolean;
	className?: string;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			aria-pressed={active ?? undefined}
			disabled={disabled}
			// Un clic sur la barre ne doit pas voler le focus à l'éditeur.
			onMouseDown={(e) => e.preventDefault()}
			onClick={onClick}
			className={cn(
				"inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg transition-colors",
				"text-white/70 hover:bg-white/10 hover:text-white",
				"focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dbz-orange",
				"disabled:pointer-events-none disabled:opacity-30",
				// 44 px sur mobile (cible tactile), 32 px sur pointeur fin.
				compact ? "size-9 md:size-8" : "h-11 min-w-11 px-2 md:h-8 md:min-w-8 md:px-1.5",
				showLabel && "px-3",
				active && "bg-dbz-orange/20 text-dbz-orange",
				className
			)}
		>
			{Icon && <Icon className="size-4" />}
			{showLabel && <span className="text-[13px] font-medium">{label}</span>}
		</button>
	);
}

export function ToolGroup({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div
			className={cn(
				"flex shrink-0 items-center gap-0.5 border-white/10",
				"[&:not(:last-child)]:border-r [&:not(:last-child)]:pr-1 [&:not(:last-child)]:mr-1",
				className
			)}
		>
			{children}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Panneau : popover sur grand écran, feuille en bas sur mobile               */
/* -------------------------------------------------------------------------- */

export function EditorPanel({
	title,
	open,
	onClose,
	children,
	footer,
	wide,
}: {
	title: string;
	open: boolean;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
	wide?: boolean;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	useFocusTrap(panelRef, open, onClose);

	// Le défilement de fond est gelé tant que la feuille mobile est ouverte.
	useEffect(() => {
		if (!open) return;
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = prev;
		};
	}, [open]);

	if (!open || !mounted) return null;

	return createPortal(
		<div
			className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center"
			role="presentation"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />
			<div
				ref={panelRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className={cn(
					"relative flex max-h-[85dvh] w-full flex-col overflow-hidden border border-white/12 bg-[#131316] shadow-2xl outline-none",
					"rounded-t-2xl sm:rounded-2xl",
					wide ? "sm:max-w-2xl" : "sm:max-w-md",
					// Marge basse = hauteur du clavier virtuel éventuel.
					"pb-[env(safe-area-inset-bottom)]"
				)}
			>
				{/* Poignée visuelle de la feuille mobile */}
				<div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20 sm:hidden" aria-hidden />
				<div className="flex items-center justify-between gap-3 px-4 py-3">
					<h2 className="text-[15px] font-semibold text-white">{title}</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label="Fermer"
						className="grid size-9 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
					>
						<Croix className="size-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
				{footer && (
					<div className="flex items-center justify-end gap-2 border-t border-white/10 bg-black/20 px-4 py-3">
						{footer}
					</div>
				)}
			</div>
		</div>,
		document.body
	);
}

/* -------------------------------------------------------------------------- */
/* Champs de formulaire des panneaux                                          */
/* -------------------------------------------------------------------------- */

export function PanelField({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<label className="mb-3 block">
			<span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/50">
				{label}
			</span>
			{children}
			{hint && <span className="mt-1 block text-[12px] text-white/45">{hint}</span>}
		</label>
	);
}

export const panelInputClass =
	"w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-[15px] text-white outline-none transition-colors placeholder:text-white/30 focus:border-dbz-orange md:text-[14px]";

export function PanelButton({
	children,
	onClick,
	variant = "ghost",
	disabled,
	type = "button",
}: {
	children: ReactNode;
	onClick?: () => void;
	variant?: "primary" | "ghost" | "danger";
	disabled?: boolean;
	type?: "button" | "submit";
}) {
	return (
		<button
			type={type}
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold transition-colors disabled:opacity-40",
				variant === "primary" && "bg-dbz-orange text-black hover:bg-dbz-yellow",
				variant === "ghost" && "text-white/70 hover:bg-white/10 hover:text-white",
				variant === "danger" && "bg-red-500/15 text-red-300 hover:bg-red-500/25"
			)}
		>
			{children}
		</button>
	);
}

/** Choix segmenté (taille d'image, placement…) — tactile et lisible. */
export function SegmentedControl<T extends string>({
	value,
	options,
	onChange,
	ariaLabel,
}: {
	value: T;
	options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
	onChange: (v: T) => void;
	ariaLabel: string;
}) {
	return (
		<div
			role="radiogroup"
			aria-label={ariaLabel}
			className="flex w-full gap-1 rounded-lg border border-white/12 bg-black/30 p-1"
		>
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					role="radio"
					aria-checked={value === o.value}
					onClick={() => onChange(o.value)}
					className={cn(
						"flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-colors",
						value === o.value ? "bg-dbz-orange text-black" : "text-white/60 hover:bg-white/10"
					)}
				>
					{o.icon && <o.icon className="size-3.5" />}
					{o.label}
				</button>
			))}
		</div>
	);
}
