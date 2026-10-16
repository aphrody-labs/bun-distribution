"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "../lib/utils";

/**
 * base-ui expose `data-checked` / `data-unchecked` sur la Root ET le Thumb
 * (cf. `switch/stateAttributesMapping.js`) — pas de `data-state="checked"`
 * façon radix. Le Thumb est rendu par `Switch` (il est aussi exporté seul pour
 * les compositions sur mesure via `SwitchPrimitive.Root`).
 */
function Switch({
	className,
	thumbClassName,
	...props
}: Omit<SwitchPrimitive.Root.Props, "key"> & { thumbClassName?: string }) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				// `cible-44` : le dessin reste à 36 × 20 px (l'interrupteur doit rester
				// discret dans une rangée de réglages) mais la zone atteignable au
				// pouce passe à 44 px via un pseudo-élément, hors flux. Sans lui, la
				// cible échouait même le minimum de 24 px de WCAG 2.5.8.
				"cible-44 peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-black/80 bg-black/60 p-0.5 transition-all outline-none cursor-pointer",
				"data-[unchecked]:bg-black/80",
				"data-[checked]:bg-gradient-to-r data-[checked]:from-dbz-orange data-[checked]:to-amber-500",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/40",
				"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				"aria-invalid:border-destructive",
				className
			)}
			{...props}
		>
			<SwitchThumb className={thumbClassName} />
		</SwitchPrimitive.Root>
	);
}

function SwitchThumb({ className, ...props }: Omit<SwitchPrimitive.Thumb.Props, "key">) {
	return (
		<SwitchPrimitive.Thumb
			data-slot="switch-thumb"
			className={cn(
				"pointer-events-none block size-4.5 rounded-full border border-black/80 bg-white transition-transform",
				"data-[unchecked]:translate-x-0 data-[checked]:translate-x-5 data-[checked]:bg-yellow-100",
				className
			)}
			{...props}
		/>
	);
}

export { Switch, SwitchThumb };
