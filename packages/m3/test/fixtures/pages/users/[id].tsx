import type { M3PageProps } from "../../../../src/server.ts";

export default function User({ params, request }: M3PageProps) {
  return (
    <html>
      <body>
        <h1>User {params.id}</h1>
        <p>{new URL(request.url).searchParams.get("view")}</p>
      </body>
    </html>
  );
}
