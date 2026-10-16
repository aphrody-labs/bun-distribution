// SPDX-License-Identifier: Apache-2.0
import { supervise } from "../../src/python-workspace.ts";

if (process.argv[2] === "leaf") {
  process.on("SIGTERM", () => {});
  await Bun.write(process.argv[3]!, "ready");
  setInterval(() => {}, 1000);
} else if (process.argv[2] === "tree" || process.argv[2] === "orphan") {
  const directory = process.argv[3]!;
  const child = Bun.spawn(
    [
      process.execPath,
      `${import.meta.dir}/python-workspace.ts`,
      "leaf",
      `${directory}/ready`,
    ],
    {
      windowsHide: true,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  child.unref();
  while (!(await Bun.file(`${directory}/ready`).exists())) await Bun.sleep(5);
  await Bun.write(
    `${directory}/pids.json`,
    JSON.stringify([process.pid, child.pid]),
  );
  if (process.argv[2] === "orphan") process.exit(0);
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
} else if (process.argv[2] === "flood") {
  process.stdout.write(new Uint8Array(64 * 1024));
} else if (process.argv[2] === "measure") {
  console.log(
    JSON.stringify(
      await supervise(
        [process.execPath, `${import.meta.dir}/python-workspace.ts`, "0"],
        "/",
      ),
    ),
  );
} else {
  console.log("fixture stdout");
  console.error("fixture stderr");
  process.exitCode = Number(process.argv[2]);
}
