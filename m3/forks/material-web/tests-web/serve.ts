// Static server for the tests-web harness (see README.md), through serveM3 from @aphrody/m3.
// Imported by relative path: @aphrody/m3 depends on this package, so a workspace dependency
// back to it would form a cycle.
//
//   bun tests-web/serve.ts "$PWD"      # http://127.0.0.1:8799/
import { resolve } from "node:path";
import { serveM3 } from "../../m3/src/server.ts";

const root = resolve(process.argv[2] ?? ".");
const srv = await serveM3({
  port: 8799,
  hmr: false,
  routes: {
    "/": Bun.file(resolve(root, "tests-web/index.html")),
    "/*": { dir: root },
  },
});
console.log("serving", root, "on", srv.port);
