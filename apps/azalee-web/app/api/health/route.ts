import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { resolveMirrorPath } from "@rosegriffon/azalee/config";
import { createSqliteClient } from "@rosegriffon/azalee/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const mirrorPath = resolveMirrorPath();
  const checks: Record<string, "ok" | "error"> = {
    mirror: "error",
  };

  if (mirrorPath && existsSync(mirrorPath)) {
    try {
      const { error } = await createSqliteClient().from("inagle_characters").select("id").limit(1);
      checks.mirror = error ? "error" : "ok";
    } catch {
      checks.mirror = "error";
    }
  }

  const allOk = checks.mirror === "ok";

  return NextResponse.json(
    {
      checks,
      source: "sqlite-mirror",
      status: allOk ? "ok" : "degraded",
      uptime: process.uptime(),
    },
    { status: allOk ? 200 : 503 },
  );
}
