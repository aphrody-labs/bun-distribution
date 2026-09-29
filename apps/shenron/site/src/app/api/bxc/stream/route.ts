import { NextResponse } from "next/server";
import { bxc } from "@/lib/bxc";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const resolveUrl = searchParams.get("resolve") || searchParams.get("url");
  const searchQuery = searchParams.get("search");

  try {
    if (resolveUrl) {
      const resolved = await bxc.media.resolveEmbed(resolveUrl);
      return NextResponse.json({
        success: true,
        source: resolveUrl,
        result: resolved,
      });
    }

    if (searchQuery) {
      const searchResults = await bxc.media.searchMedia(searchQuery);
      return NextResponse.json({
        success: true,
        query: searchQuery,
        results: searchResults,
      });
    }

    return NextResponse.json(
      { error: "Paramètre 'resolve' (URL embed) ou 'search' (titre) requis." },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erreur lors de la résolution de flux via BXC",
      },
      { status: 500 }
    );
  }
}
