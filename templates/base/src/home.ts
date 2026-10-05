// The `/` route. The `web` feature replaces this file with an HTML-bundle route.
export const homeRoutes = {
  "/": () =>
    Response.json({
      name: "__NAME__",
      endpoints: ["/health", "/api/stats", "/api/bench?n=1000000", "/api/events"],
    }),
};
