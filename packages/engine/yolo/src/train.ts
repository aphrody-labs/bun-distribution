// SPDX-License-Identifier: Apache-2.0
/** `yolo train`: thin delegate of `aphrody train` (datasets, jobs, promotion) in the Rust owner. */
import { runAphrody } from "./aphrody-delegate";

export async function runTrainCommand(args: readonly string[]): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h") {
    console.log(
      "Usage: yolo train <aphrody train arguments>\n\nDelegates to `aphrody train` (run `aphrody train --help`).",
    );
    return 0;
  }
  const result = await runAphrody(["train", ...args], { inherit: true });
  return result.code;
}
