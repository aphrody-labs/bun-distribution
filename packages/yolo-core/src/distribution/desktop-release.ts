/** Native Yolo owner of precompiled desktop packaging, installation and rollback. */
import { resolve } from "node:path";
import { packageDesktop } from "./desktop-package";
import {
  desktopHome,
  installDesktopArtifact,
  installedDesktopExecutable,
  rollbackDesktopArtifact,
  verifyDesktopArtifact,
  verifyInstalledDesktopArtifact,
} from "@aphrody/runtime-sdk/desktop-artifact";

export function runDesktopRelease(args: readonly string[]): number {
  const action = args[0] ?? "help";
  const option = (name: string): string | undefined => {
    const index = args.indexOf("--" + name);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error("--" + name + " requires a value");
    return value;
  };
  if (action === "help" || args.includes("--help")) {
    console.log(
      "yolo desktop-runtime package|install|verify|rollback|info [artifact] [--root SOURCE] [--binary EXE] [--cef-dir DIR] [--output DIR] [--home DIR] [--allow-dirty] [--no-strip]",
    );
    return 0;
  }
  const home = option("home") ?? desktopHome();
  switch (action) {
    case "package": {
      packageDesktop({
        root: option("root") ?? process.cwd(),
        ...(option("binary") === undefined
          ? {}
          : { executable: option("binary")! }),
        ...(option("output") === undefined
          ? {}
          : { output: option("output")! }),
        ...(option("cef-dir") === undefined
          ? {}
          : { cefDir: option("cef-dir")! }),
        allowDirty: args.includes("--allow-dirty"),
        strip: !args.includes("--no-strip"),
      });
      return 0;
    }
    case "install":
      if (args[1] === undefined || args[1].startsWith("--"))
        throw new Error(
          "install requires a verified desktop artifact directory",
        );
      console.log(
        JSON.stringify({
          installed: installDesktopArtifact(resolve(args[1]), home),
          home,
        }),
      );
      return 0;
    case "verify": {
      const explicit =
        args[1] !== undefined && !args[1].startsWith("--")
          ? resolve(args[1])
          : undefined;
      console.log(
        JSON.stringify(
          explicit === undefined
            ? verifyInstalledDesktopArtifact(home)
            : verifyDesktopArtifact(explicit),
        ),
      );
      return 0;
    }
    case "rollback":
      console.log(
        JSON.stringify({ current: rollbackDesktopArtifact(home), home }),
      );
      return 0;
    case "info":
      if (option("home") !== undefined)
        throw new Error(
          "info resolves YOLO_HOME; use verify for an explicit --home",
        );
      console.log(
        JSON.stringify({
          home,
          executable: installedDesktopExecutable() ?? null,
        }),
      );
      return 0;
    default:
      throw new Error("Unknown desktop-runtime action: " + action);
  }
}
if (import.meta.main) process.exit(runDesktopRelease(process.argv.slice(2)));
