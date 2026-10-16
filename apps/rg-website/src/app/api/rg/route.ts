import { NextResponse } from "next/server";

import { SITE_URL } from "@/lib/site-url";

// Réponse 100% statique, change avec NEXT_PUBLIC_SITE_URL build time.
export const revalidate = 86_400;

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || SITE_URL;

  return NextResponse.json({
    documentation: "Cette API est destinée à être utilisée par les sites partenaires de Rose Griffon.",
    endpoints: {
      articles: `${baseUrl}/api/rg/articles`,
      emotes: `${baseUrl}/api/rg/emotes`,
      info: `${baseUrl}/api/rg/info`,
      planning: `${baseUrl}/api/rg/planning`,
    },
    name: "Rose Griffon Public API",
    version: "1.0.0",
  });
}
