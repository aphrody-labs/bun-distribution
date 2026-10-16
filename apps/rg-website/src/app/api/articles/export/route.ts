import { NextResponse } from "next/server";
import { exportArticleStatsCSV } from "@/app/actions/stats-export";
import { requireAdmin } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireAdmin();
    const csv = await exportArticleStatsCSV();

    return new NextResponse(csv, {
      headers: {
        "Content-Disposition": `attachment; filename="articles-stats-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch (error) {
    const isAuthError =
      error instanceof Error &&
      (error.message.includes("NEXT_REDIRECT") ||
        error.message.includes("Non autorisé") ||
        error.message.includes("redirect"));
    return NextResponse.json(
      { error: isAuthError ? "Non autorisé" : "Erreur lors de l'export des statistiques" },
      { status: isAuthError ? 403 : 500 },
    );
  }
}
