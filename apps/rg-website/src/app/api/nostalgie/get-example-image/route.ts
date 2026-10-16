import { NextResponse } from "next/server";

import { createPostgresClient } from "@rosegriffon/db/service";

/**
 * API Route pour récupérer l'URL publique ou signée de l'image ogVR.jpg
 * depuis le bucket 'nostalgie' de Supabase Storage
 *
 * Endpoints:
 * GET /api/nostalgie/get-example-image - Récupère l'URL publique/signée
 */

export async function GET() {
  try {
    const supabase = createPostgresClient();

    if (!supabase) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }

    const bucketName = "nostalgie";
    const fileName = "ogVR.jpg";

    // Try to get public URL first (if bucket is public)
    const { data: publicData } = supabase.storage.from(bucketName).getPublicUrl(fileName);

    // If bucket is private, create a signed URL (5 minutes validity)
    const { data: signedData, error: signedError } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(fileName, 300); // 5 minutes

    if (signedError && signedData === null) {
      // If signed URL fails, return public URL as fallback
      console.warn(`Could not create signed URL for ${fileName}: ${signedError.message}`);
      return NextResponse.json({
        bucket: bucketName,
        file: fileName,
        success: true,
        type: "public",
        url: publicData.publicUrl,
      });
    }

    // Return signed URL if available
    if (signedData?.signedUrl) {
      return NextResponse.json({
        bucket: bucketName,
        expiresIn: 300,
        file: fileName,
        success: true,
        type: "signed",
        url: signedData.signedUrl,
      });
    }

    // Fallback to public URL
    return NextResponse.json({
      bucket: bucketName,
      file: fileName,
      success: true,
      type: "public",
      url: publicData.publicUrl,
    });
  } catch (error) {
    console.error("Error fetching example image URL:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch image URL",
        success: false,
      },
      { status: 500 },
    );
  }
}
