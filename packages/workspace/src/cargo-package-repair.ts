import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Rename = { name_to?: string };

export async function runCargoPackageRepair(args: string[]): Promise<number> {
  const tableIndex = args.indexOf("--rename-table");
  const apply = args.includes("--apply");
  const repositories = args.filter(
    (arg, index) =>
      arg !== "--apply" && index !== tableIndex && index !== tableIndex + 1,
  );
  const table = tableIndex === -1 ? undefined : args[tableIndex + 1];
  if (!table || repositories.length === 0)
    throw new Error(
      "Usage: yolo ops cargo-package-repair --rename-table <file> <repo>... [--apply]",
    );
  const names = (JSON.parse(await readFile(resolve(table), "utf8")) as Rename[])
    .map((entry) => entry.name_to)
    .filter((name): name is string => Boolean(name?.startsWith("aphrody-")));
  let repaired = 0;
  for (const repository of repositories) {
    const root = resolve(repository);
    const child = Bun.spawn(
      [
        "git",
        "-C",
        root,
        "grep",
        "-lE",
        "--",
        "(-p|--package)-[a-z0-9]",
        "--",
        ":!*.lock",
      ],
      { windowsHide: true, stdout: "pipe", stderr: "pipe" },
    );
    // oxlint-disable-next-line no-await-in-loop -- dépôts traités un par un : sortie console et code de retour dans l'ordre
    const [code, stdout] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
    ]);
    if (code > 1) throw new Error(`git grep failed for ${root}`);
    for (const file of stdout.trim().split("\n").filter(Boolean)) {
      const path = `${root}/${file}`;
      // oxlint-disable-next-line no-await-in-loop -- fichiers traités un par un : journal console et réécritures dans l'ordre
      const text = await readFile(path, "utf8").catch(() => undefined);
      if (text === undefined) continue;
      let fixed = text;
      for (const name of names) {
        const suffix = name
          .slice("aphrody-".length)
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        for (const option of ["-p", "--package"]) {
          fixed = fixed.replace(
            new RegExp(
              `(^|[^\\w-])${option}-${suffix}(?=[\\s\\x60"':,]|$)`,
              "gm",
            ),
            `$1${option} ${name}`,
          );
        }
      }
      if (fixed === text) continue;
      repaired += 1;
      console.log(`repaired ${file}`);
      // oxlint-disable-next-line no-await-in-loop -- réécritures séquentielles, une par fichier réparé
      if (apply) await writeFile(path, fixed);
    }
  }
  console.log(`${repaired} file(s)${apply ? "" : " (dry run: pass --apply)"}`);
  return 0;
}
