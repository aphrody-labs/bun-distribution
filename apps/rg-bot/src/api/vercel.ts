import { app } from "./server";

// Vercel Function entry of the unified Rose Griffon API on the Bun runtime.
// The Elysia app answers each request in-process: no listener, no timers.
export default {
  fetch: (request: Request) => app.handle(request),
};
