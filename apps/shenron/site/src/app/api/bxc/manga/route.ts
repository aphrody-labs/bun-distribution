import { NextResponse } from "next/server";
import { bxc, type DbcnCatalogCategory } from "@/lib/bxc";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "catalog";

  try {
    if (action === "catalog") {
      const category = (searchParams.get("category") || "full_color") as DbcnCatalogCategory;
      const catalog = await bxc.dragonballcn.catalog(category);
      return NextResponse.json(
        {
          success: true,
          category,
          total: catalog.length,
          items: catalog,
        },
        {
          headers: {
            "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
          },
        }
      );
    }

    if (action === "volume" || action === "info") {
      const did = searchParams.get("did");
      if (!did) {
        return NextResponse.json(
          { error: "Paramètre 'did' requis (ex: ?did=0-10-1)" },
          { status: 400 }
        );
      }

      const volumeInfo = await bxc.dragonballcn.info(did);
      return NextResponse.json(
        {
          success: true,
          volume: volumeInfo,
        },
        {
          headers: {
            "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
          },
        }
      );
    }

    if (action === "page") {
      const did = searchParams.get("did");
      const pageStr = searchParams.get("page");
      if (!did || !pageStr) {
        return NextResponse.json(
          { error: "Paramètres 'did' et 'page' requis (ex: ?did=0-10-1&page=1)" },
          { status: 400 }
        );
      }

      const pageNum = Number.parseInt(pageStr, 10);
      if (Number.isNaN(pageNum) || pageNum < 1) {
        return NextResponse.json(
          { error: "Numéro de page invalide" },
          { status: 400 }
        );
      }

      const pageView = await bxc.dragonballcn.view(did, pageNum);
      return NextResponse.json({
        success: true,
        page: pageView,
      });
    }

    return NextResponse.json(
      { error: `Action inconnue '${action}'. Actions valides: catalog, volume, page.` },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erreur interne lors de la requête manga BXC",
      },
      { status: 500 }
    );
  }
}
