import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@rosegriffon/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { Heart, Mail, Users } from "@/lib/icons-config";
import { absoluteUrl } from "@/lib/site-url";
import { BreadcrumbSchema, OrganizationSchema } from "@/components/shared/StructuredData";

export const metadata: Metadata = {
  title: "À propos | Rose Griffon",
  description:
    "À propos de l'association Rose Griffon, la communauté Inazuma Eleven en France. Découvrez comment nous rejoindre, nous soutenir ou nous contacter.",
  alternates: {
    canonical: absoluteUrl("/a-propos"),
  },
  openGraph: {
    title: "À propos | Rose Griffon",
    description: "À propos de l'association Rose Griffon, la communauté Inazuma Eleven en France.",
    url: absoluteUrl("/a-propos"),
    type: "website",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Rose Griffon - À propos",
      },
    ],
  },
};

export const dynamic = "force-dynamic";

export default function AProposPage() {
  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "Accueil", item: "/" },
          { name: "À propos", item: "/a-propos" },
        ]}
      />
      <OrganizationSchema />
      <div className="container mx-auto py-12 px-4">
        <h1 className="text-4xl font-bold mb-8 text-center">À propos de Rose Griffon</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <Users className="size-12 text-primary mb-4" />
              <CardTitle>Rejoindre l&apos;équipe</CardTitle>
              <CardDescription>Devenez bénévole et participez à l&apos;aventure</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/a-propos/rejoindre-rg">Nous rejoindre</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <Heart className="size-12 text-primary mb-4" />
              <CardTitle>Nous soutenir</CardTitle>
              <CardDescription>Aidez l&apos;association à grandir</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" variant="secondary">
                <Link href="/a-propos/soutenir">Faire un don</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <Mail className="size-12 text-primary mb-4" />
              <CardTitle>Contact</CardTitle>
              <CardDescription>Une question ? Écrivez-nous</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" variant="outline">
                <Link href="/a-propos/contact">Contactez-nous</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
