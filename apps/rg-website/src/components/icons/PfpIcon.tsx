import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * Icône personnalisée pour le générateur d'avatar
 * Utilise l'overlay officiel depuis /public
 */
export const PfpIcon = ({ className }: { className?: string }) => (
	<Image
		src="/overlay.webp"
		alt="Avatar RG"
		width={24}
		height={24}
		className={cn("rounded-sm object-contain", className)}
	/>
);
