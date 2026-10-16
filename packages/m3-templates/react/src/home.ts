import homepage from "./web/index.html";

// Bun bundles the HTML, its React entry point and the Material 3 components on the fly in development and
// for production builds. The `react` feature replaces this file the way the `web` feature does.
export const homeRoutes = { "/": homepage };
