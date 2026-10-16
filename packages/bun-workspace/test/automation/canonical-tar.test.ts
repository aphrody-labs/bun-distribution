// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalTar, gzipCanonical, readTar } from "../../src/automation/canonical-tar.ts";

// CPython is the oracle: it writes varied source archives, then canonicalises them with the exact
// tarfile/gzip code the package archive producer ran before the TypeScript port.
const ORACLE = String.raw`import gzip, io, os, sys, tarfile
out = sys.argv[1]
noise = bytes((index * 7919 + (index >> 3)) % 256 for index in range(300_000))
def entries(long_name):
    return [
        ("package/", tarfile.DIRTYPE, b"", 0o700),
        ("package/legacy-dir/", tarfile.AREGTYPE, b"", 0o755),
        ("package/bin/run", tarfile.REGTYPE, b"#!/bin/sh\necho ok\n", 0o751),
        ("package/empty.txt", tarfile.REGTYPE, b"", 0o600),
        ("package/na\u00efve/\u00e9moji-\U0001f600.ts", tarfile.REGTYPE, "export const \u00e9 = 1;\n".encode(), 0o664),
        ("package/data/noise.bin", tarfile.REGTYPE, noise, 0o644),
        (long_name, tarfile.REGTYPE, b"long\n", 0o644),
        ("package/a-b.ts", tarfile.REGTYPE, b"a-b\n", 0o644),
        ("package/a/b.ts", tarfile.REGTYPE, b"a/b\n", 0o644),
    ]
def write(path, fmt, members, symlink=False):
    with tarfile.open(path, "w:gz", format=fmt) as archive:
        for name, kind, data, mode in members:
            entry = tarfile.TarInfo(name)
            entry.type, entry.mode, entry.size = kind, mode, len(data)
            entry.uid, entry.gid, entry.uname, entry.gname, entry.mtime = 1000, 1001, "host", "group", 123456789
            if fmt == tarfile.PAX_FORMAT:
                entry.pax_headers = {"atime": "999.5"}
            archive.addfile(entry, io.BytesIO(data) if kind in (tarfile.REGTYPE, tarfile.AREGTYPE) else None)
        if symlink:
            link = tarfile.TarInfo("package/link")
            link.type, link.linkname = tarfile.SYMTYPE, "../outside"
            archive.addfile(link)
def canonicalize(path):
    payload = io.BytesIO()
    with tarfile.open(path, 'r:gz') as source:
        entries = source.getmembers()
        names = [entry.name for entry in entries]
        if len(names) != len(set(names)):
            raise SystemExit('Duplicate archive entry')
        with tarfile.open(fileobj=payload, mode='w', format=tarfile.PAX_FORMAT) as target:
            for entry in sorted(entries, key=lambda item: item.name):
                if not (entry.isfile() or entry.isdir()):
                    raise SystemExit('Unsupported archive entry type: ' + entry.name)
                canonical = tarfile.TarInfo(entry.name)
                canonical.type = tarfile.DIRTYPE if entry.isdir() else tarfile.REGTYPE
                canonical.size = 0 if entry.isdir() else entry.size
                canonical.mode = 0o755 if entry.isdir() or entry.mode & 0o111 else 0o644
                canonical.mtime = 0
                canonical.uid = canonical.gid = 0
                canonical.uname = canonical.gname = ''
                canonical.pax_headers = {}
                target.addfile(canonical, source.extractfile(entry) if entry.isfile() else None)
    with open(path + '.oracle', 'wb') as output:
        with gzip.GzipFile(filename='', mode='wb', fileobj=output, compresslevel=9, mtime=0) as compressed:
            compressed.write(payload.getvalue())
long_name = "package/" + "d" * 60 + "/" + "f" * 60 + ".ts"
for label, fmt in (("pax", tarfile.PAX_FORMAT), ("gnu", tarfile.GNU_FORMAT), ("ustar", tarfile.USTAR_FORMAT)):
    path = os.path.join(out, label + ".tgz")
    write(path, fmt, entries(long_name))
    canonicalize(path)
write(os.path.join(out, "symlink.tgz"), tarfile.PAX_FORMAT, entries(long_name)[:2], symlink=True)
`;

let directory = "";
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "canonical-tar-"));
  // The oracle bytes are those of CPython >= 3.12 (`requires-python` of py/): uv resolves an installed
  // interpreter of that range first, since the distribution `python3` can be older (3.11 in Ubuntu 24.04
  // cloud containers). `python3` and `python` follow for POSIX and Windows hosts without uv.
  const launchers = [["uv", "run", "--no-project", "--python", ">=3.12", "python"], ["python3"], ["python"]];
  let failure = "no CPython interpreter found";
  for (const launcher of launchers) {
    try {
      const oracle = Bun.spawnSync([...launcher, "-I", "-c", ORACLE, directory], {
        windowsHide: true,
        stderr: "pipe",
      });
      if (oracle.exitCode === 0) return;
      failure = oracle.stderr.toString();
    } catch (error) {
      failure = String(error);
    }
  }
  throw new Error(failure);
});
afterAll(() => rm(directory, { recursive: true, force: true }));

test.each(["pax", "gnu", "ustar"])("%s sources canonicalise to the CPython bytes", async label => {
  const source = new Uint8Array(await readFile(join(directory, `${label}.tgz`)));
  const oracle = new Uint8Array(await readFile(join(directory, `${label}.tgz.oracle`)));
  const members = readTar(Bun.gunzipSync(source));
  // After a pax header tarfile keeps the V7 slash-named entry as a regular file.
  const legacy = members.find(member => member.name.startsWith("package/legacy-dir"));
  expect(legacy?.type).toBe(label === "pax" ? "file" : "directory");
  expect(Buffer.from(gzipCanonical(canonicalTar(members))).equals(Buffer.from(oracle))).toBe(true);
});

test("links are refused before canonicalisation, duplicates during it", async () => {
  const linked = readTar(Bun.gunzipSync(await readFile(join(directory, "symlink.tgz"))));
  expect(() => canonicalTar(linked)).toThrow("Unsupported archive entry type: package/link");
  const [first] = readTar(Bun.gunzipSync(await readFile(join(directory, "pax.tgz"))));
  expect(() => canonicalTar([first!, { ...first! }])).toThrow("Duplicate archive entry");
});
