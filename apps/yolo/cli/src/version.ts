/**
 * `yolo version`: the one command every wrapper runs as a preflight, so it loads only the home resolver and the
 * target table (no FFI runtime, no command modules). `distribution.ts` re-exports `runVersion`.
 */
import { hostTarget } from "@aphrody/runtime-sdk/src/target.ts";
import { yoloVersion } from "./home";

export function runVersion(args: readonly string[] = []): number {
  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          schema: "yolo.version/1",
          version: yoloVersion(),
          target: hostTarget(),
          bunVersion: Bun.version,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  console.log(`yolo ${yoloVersion()} (${hostTarget()}, Bun ${Bun.version})`);
  return 0;
}
