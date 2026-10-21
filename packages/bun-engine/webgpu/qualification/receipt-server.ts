interface QualificationReceipt {
  status: "passed" | "failed";
  qualification: "webx-wire-spirv-webgpu-triangle";
  timestamp?: string;
  [key: string]: unknown;
}

const receipts: QualificationReceipt[] = [];
const maxReceiptBytes = 64 * 1024;

function isQualificationReceipt(value: unknown): value is QualificationReceipt {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.qualification === "webx-wire-spirv-webgpu-triangle" &&
    (candidate.status === "passed" || candidate.status === "failed")
  );
}

Bun.serve({
  hostname: "127.0.0.1",
  port: 4540,
  maxRequestBodySize: maxReceiptBytes,
  async fetch(request: Request): Promise<Response> {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS, GET",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
    };
    const url = new URL(request.url);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(
        { ok: true, acceptedReceipts: receipts.length },
        { headers: cors },
      );
    }
    if (request.method !== "POST" || url.pathname !== "/receipt") {
      return new Response("not found", { status: 404, headers: cors });
    }
    const body = await request.arrayBuffer();
    if (body.byteLength > maxReceiptBytes) {
      return new Response("receipt too large", { status: 413, headers: cors });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return new Response("invalid JSON", { status: 400, headers: cors });
    }
    if (!isQualificationReceipt(parsed)) {
      return new Response("invalid qualification receipt", {
        status: 422,
        headers: cors,
      });
    }
    const receipt = parsed;
    receipts.push(receipt);
    if (receipts.length > 16) receipts.shift();
    console.log(
      JSON.stringify({ receivedAt: new Date().toISOString(), receipt }),
    );
    return Response.json(
      { accepted: true, index: receipts.length - 1 },
      { headers: cors },
    );
  },
});

console.log(
  "WebX qualification receipt collector listening on http://127.0.0.1:4540",
);
