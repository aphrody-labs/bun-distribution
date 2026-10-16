import { defineM3Api } from "../../../../src/api.ts";

export default defineM3Api({
  "/api/hello/:name": (request) =>
    Response.json({ hello: request.params.name }),
  "/api/items": {
    GET: () => Response.json([{ id: 1 }]),
    POST: async (request) =>
      Response.json(await request.json(), { status: 201 }),
  },
});
