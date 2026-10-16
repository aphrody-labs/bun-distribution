import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiAdmin } from "@/lib/api-auth";
import { createPostgresClient } from "@rosegriffon/db/service";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: NextRequest) {
  const auth = await requireApiAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const db = createPostgresClient();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large" }, { status: 413 });
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: "Unsupported media type" }, { status: 415 });
    }

    const buffer = await file.arrayBuffer();

    const { data, error } = await db.storage.from("nostalgie-examples").upload("ogVR.jpg", new Uint8Array(buffer), {
      contentType: file.type,
      upsert: true,
    });

    if (error) {
      console.error("Upload error:", error);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const { data: publicUrlData } = db.storage.from("nostalgie-examples").getPublicUrl("ogVR.jpg");

    return NextResponse.json({
      path: data?.path,
      publicUrl: publicUrlData?.publicUrl,
      success: true,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
