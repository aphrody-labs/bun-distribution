// Prefer the installed precompiled runtime from the producer this project links to.
// A source checkout may still provide an explicitly built local library.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultLibraryPath, libraryFile } from "@aphrody/runtime-sdk";

if (
  !process.env["YOLO_RUNTIME_LIB"] &&
  !process.env["YOLO_RUNTIME_HOME"] &&
  !process.env["YOLO_HOME"]
) {
  process.env["YOLO_HOME"] = "__YOLO__";
}
if (!existsSync(defaultLibraryPath())) {
  const local = join("__YOLO__", "target/runtime", libraryFile());
  if (existsSync(local)) process.env["YOLO_RUNTIME_LIB"] = local;
}
