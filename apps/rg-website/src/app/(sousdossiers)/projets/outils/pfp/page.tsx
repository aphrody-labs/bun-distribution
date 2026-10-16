import type { Metadata } from "next";

import { BreadcrumbSchema } from "@/components/shared/StructuredData";
import PfpGenerator from "@/components/tools/PfpGenerator";
import PfpThemeImage from "@/components/tools/PfpThemeImage";
import { absoluteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/projets/outils/pfp") },
  description:
    "Créez votre photo de profil aux couleurs de Rose Griffon avec notre outil de personnalisation d'avatar.",
  title: "Avatar RG | Rose Griffon",
};

export default function PfpPage() {
  return (
    <div className="container py-12 md:py-20 relative">
      <BreadcrumbSchema
        items={[
          { item: "/", name: "Accueil" },
          { item: "/projets", name: "Projets" },
          { item: "/projets/outils/pfp", name: "Avatar RG" },
        ]}
      />
      {/* Background elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] size-[40%] bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-10%] size-[40%] bg-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-8">
          <div className="text-center space-y-4">
            <p className="text-xl text-muted-foreground leading-relaxed">
              Personnalisez votre photo de profil en quelques clics et montrez votre appartenance à la communauté{" "}
              <span className="font-semibold text-primary">Rose Griffon</span>.
            </p>
          </div>
          <PfpGenerator />
        </div>
        <PfpThemeImage />
      </div>
    </div>
  );
}
