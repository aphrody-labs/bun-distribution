import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { z } from "zod";

const reportSchema = z.object({
  version: z.literal(1),
  success: z.literal(true),
  files: z.array(z.unknown()),
});
const fileSchema = z.object({
  name: z.string(),
  durationMs: z.number().finite().positive(),
});

export function parseTestDurations(
  contents: string,
  root: string,
): Map<string, number> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  const report = reportSchema.safeParse(value);
  if (!report.success) return undefined;

  const durations = new Map<string, number>();
  for (const value of report.data.files) {
    const result = fileSchema.safeParse(value);
    if (!result.success) continue;
    const { name, durationMs } = result.data;
    const path = relative(root, resolve(root, name));
    if (
      path === "" ||
      path === ".." ||
      path.startsWith(".." + sep) ||
      isAbsolute(path)
    )
      continue;
    const key = path.split(sep).join("/");
    durations.set(key, Math.max(durations.get(key) ?? 0, durationMs));
  }
  return durations.size ? durations : undefined;
}

export async function readTestDurations(
  historyPath: string,
  root: string,
): Promise<Map<string, number> | undefined> {
  try {
    return parseTestDurations(await readFile(historyPath, "utf8"), root);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}
