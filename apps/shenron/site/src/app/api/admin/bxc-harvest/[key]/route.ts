import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/session";
import { getBxcHarvestAssetPath } from "@/lib/bxc-campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
	avif: "image/avif",
	gif: "image/gif",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
};

export async function GET(_: Request, { params }: { params: Promise<{ key: string }> }) {
	if (!(await isCurrentUserAdmin())) return new NextResponse("Forbidden", { status: 403 });
	const { key } = await params;
	const path = await getBxcHarvestAssetPath(key);
	if (!path) return new NextResponse("Not found", { status: 404 });
	const ext = key.split(".").pop()?.toLowerCase() ?? "";
	return new NextResponse(await readFile(path), {
		headers: {
			"Content-Type": MIME[ext] ?? "application/octet-stream",
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
}
