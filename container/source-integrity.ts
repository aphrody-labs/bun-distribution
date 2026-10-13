import { readdir, readlink } from "node:fs/promises";
import { join } from "node:path";

/** Hash relative names, bytes and symlink targets in stable lexical order, without following links. */
export async function sourceIntegrity(root: string) {
  const tree = new Bun.CryptoHasher("sha256");
  let files = 0;
  let bytes = 0;
  const lfsPointers: string[] = [];
  async function visit(prefix: string) {
    const entries = await readdir(join(root, prefix), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        tree.update(JSON.stringify([path, "symlink", await readlink(join(root, path))]) + "\n");
      } else if (entry.isDirectory()) {
        tree.update(JSON.stringify([path, "directory"]) + "\n");
        await visit(path);
      } else if (entry.isFile()) {
        const file = Bun.file(join(root, path));
        const hash = new Bun.CryptoHasher("sha256");
        let count = 0;
        for await (const chunk of file.stream()) {
          hash.update(chunk);
          count += chunk.length;
        }
        files++;
        bytes += count;
        tree.update(JSON.stringify([path, "file", count, hash.digest("hex")]) + "\n");
        if (count < 1024 && (await file.slice(0, 80).text()).startsWith("version https://git-lfs.github.com/spec/v1"))
          lfsPointers.push(path);
      } else throw new Error(`Unsupported source entry ${path}`);
    }
  }
  await visit("");
  return { files, bytes, lfsPointers, treeSHA256: tree.digest("hex") };
}
