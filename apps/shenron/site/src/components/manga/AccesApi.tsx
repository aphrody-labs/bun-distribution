"use client";

import { ApiAccess } from "@shenron/ui/client";

export type AccesApiProps = {
	chemin: string;
	legende: string;
	variantes?: Array<{ label: string; chemin: string }>;
	className?: string;
};

/** Shenron French vocabulary adapter for the portable API-access card. */
export function AccesApi({ chemin, legende, variantes, className }: AccesApiProps) {
	return <ApiAccess path={chemin} description={legende} variants={variantes?.map(({ label, chemin: path }) => ({ label, path }))} entryPath="/api/manga" className={className} labels={{ title: "Accès API", copy: "Copier la commande curl pour", entry: "Lecture ouverte, sans clé. Point d'entrée :" }} />;
}
