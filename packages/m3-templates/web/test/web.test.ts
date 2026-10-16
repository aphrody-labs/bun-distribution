import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { defaultLibraryPath } from "@aphrody/runtime-sdk";
import { startServer } from "../src/server.ts";

(existsSync(defaultLibraryPath()) ? describe : describe.skip)(
  "web feature",
  () => {
    it("serves the bundled HTML page at /", async () => {
      const { server, db } = startServer({ port: 0 });
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/`);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(await response.text()).toContain("<title>__NAME__</title>");
      } finally {
        await server.stop(true);
        db.close();
      }
    });
  },
);
