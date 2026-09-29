import { NextResponse } from "next/server";
import { bxc } from "@/lib/bxc";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [versionRes, statsRes] = await Promise.allSettled([
      bxc.version(),
      bxc.frames.stats(),
    ]);

    const binaryPath = bxc.resolvePath();
    const version = versionRes.status === "fulfilled" ? versionRes.value : "unknown";
    const framesStats = statsRes.status === "fulfilled" ? statsRes.value : null;

    // No `bxc --version` answer means the binary is missing or broken: report the outage.
    if (versionRes.status === "rejected") {
      return NextResponse.json(
        {
          status: "unavailable",
          engine: "bxc",
          binaryPath,
          error:
            versionRes.reason instanceof Error ? versionRes.reason.message : String(versionRes.reason),
          timestamp: new Date().toISOString(),
        },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json({
      status: "online",
      engine: "bxc",
      binaryPath,
      version,
      frames: framesStats,
      features: [
        "dragonballcn",
        "frames-colorlayout",
        "animesama",
        "voiranime",
        "mediawiki",
        "google-translate",
        "db-bridge",
      ],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : "Erreur interne BXC status",
      },
      { status: 500 }
    );
  }
}
