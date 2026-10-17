import { describe, expect, test } from "bun:test";
import { app } from "../src/api/server";

describe("Unified RG API", () => {
  test("GET /health -> rg-api responds healthy", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("rg-api");
  });

  test("self-hosted storage, realtime and CDN surfaces are retired", async () => {
    const paths = ["/storage/v1/health", "/realtime/v1/health", "/cdn/health", "/upload"];
    const responses = await Promise.all(paths.map(path => app.handle(new Request(`http://localhost${path}`))));
    expect(responses.map(res => res.status)).toEqual(paths.map(() => 404));
  });
});
