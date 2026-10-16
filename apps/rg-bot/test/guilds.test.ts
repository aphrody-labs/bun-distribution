import { describe, expect, it } from "bun:test";
import { app } from "../src/api/server";

describe("unified Achillea guild routes", () => {
  it("rejects invalid pagination before querying the database", async () => {
    for (const query of ["page=0", "limit=0", "limit=101"]) {
      const response = await app.handle(new Request(`http://localhost/v1/achillea/guilds?${query}`));
      expect(response.status).toBe(422);
    }
  });

  it("rejects non-Discord guild IDs before querying the database", async () => {
    const response = await app.handle(new Request("http://localhost/v1/achillea/guilds/not-a-snowflake"));
    expect(response.status).toBe(422);
  });
});
