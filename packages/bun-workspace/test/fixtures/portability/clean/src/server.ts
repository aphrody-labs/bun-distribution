import { readFileSync } from "node:fs";
import { describe } from "./pure";

export function readSize(path: string): string {
  const home = process.env.HOME ?? "";
  return describe({ size: readFileSync(path).length + home.length });
}
