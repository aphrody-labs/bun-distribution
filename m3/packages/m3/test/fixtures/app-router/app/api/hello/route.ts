export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "world";
  return Response.json({ hello: name });
}

export async function POST(request: Request) {
  return Response.json({ echo: await request.text() }, { status: 201 });
}
