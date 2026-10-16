import type { Metadata } from "next";

import GoogleMapEpita from "@/components/maps/GoogleMapEpita";
import { absoluteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/epita-map") },
  description: "Retrouvez-nous sur le campus de l'EPITA Kremlin-Bicêtre.",
  title: "Localisation EPITA - Rose Griffon",
};

export default function EpitaMapPage() {
  return (
    <div className="container mx-auto py-12 px-4 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">Localisation du Campus</h1>
      <p className="text-lg text-gray-600 dark:text-gray-300 mb-8">
        L&apos;événement se déroule sur le campus de l&apos;EPITA au Kremlin-Bicêtre.
      </p>

      <div className="bg-white dark:bg-gray-800 p-2 rounded-2xl shadow-sm">
        <GoogleMapEpita />
      </div>

      <div className="mt-6 text-sm text-gray-500 dark:text-gray-400">
        <p>Adresse : 14-16 Rue Voltaire, 94270 Le Kremlin-Bicêtre</p>
      </div>
    </div>
  );
}
