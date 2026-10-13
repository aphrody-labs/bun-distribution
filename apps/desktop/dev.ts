import { buildDesktop } from "./build.ts";

const output = await buildDesktop();
Bun.env.APHRODY_WEB_ROOT = output + "/web";
await import("./server.ts");
