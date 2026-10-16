// Project preload: when no runtime artifact is installed (`just runtime-install`), fall back to the
// library built in the yolo checkout this project was scaffolded from.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultLibraryPath, libraryFile } from "@aphrody/runtime-sdk";

if (!existsSync(defaultLibraryPath())) {
  process.env["YOLO_RUNTIME_LIB"] = join("__YOLO__", "target/runtime", libraryFile());
}
