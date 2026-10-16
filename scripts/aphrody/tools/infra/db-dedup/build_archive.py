#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Build a verified, content-addressed tar.zst archive from scratch copies.

usage: build_archive.py SPEC.json OUT.tar.zst MANIFEST.json
SPEC: [{"origin_host", "origin_path", "scratch_path", "encoding": "raw"|"gzip", "member"}]
- raw: the member is the file bytes (payload sha256 == original sha256)
- gzip: the member is the decompressed payload (original .gz sha256 and payload sha256 both recorded)
Members are written in SPEC order with --long=30 zstd so near-identical
snapshots deduplicate. The archive is re-read after writing and every member's
sha256 is checked against the recorded payload sha256.
"""
import gzip, hashlib, json, os, subprocess, sys, tarfile, shutil

spec = json.load(open(sys.argv[1]))
out, man_path = sys.argv[2], sys.argv[3]
level = os.environ.get("ZLEVEL", "12")

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for c in iter(lambda: f.read(8 << 20), b""):
            h.update(c)
    return h.hexdigest()

entries = []
zst = subprocess.Popen(["zstd", "-q", f"-{level}", "--long=30", "-T6", "-o", out, "-f"], stdin=subprocess.PIPE)
with tarfile.open(fileobj=zst.stdin, mode="w|", format=tarfile.PAX_FORMAT) as tar:
    for e in spec:
        src = e["scratch_path"]
        st = os.stat(src)
        rec = dict(e)
        rec["original_size"] = st.st_size
        rec["original_sha256"] = sha(src)
        if e["encoding"] == "gzip":
            h = hashlib.sha256(); n = 0
            with gzip.open(src, "rb") as g:
                for c in iter(lambda: g.read(8 << 20), b""):
                    h.update(c); n += len(c)
            rec["payload_sha256"], rec["payload_size"] = h.hexdigest(), n
            ti = tarfile.TarInfo(e["member"]); ti.size = n; ti.mtime = int(st.st_mtime); ti.mode = 0o600
            with gzip.open(src, "rb") as g:
                tar.addfile(ti, g)
        else:
            rec["payload_sha256"], rec["payload_size"] = rec["original_sha256"], st.st_size
            ti = tarfile.TarInfo(e["member"]); ti.size = st.st_size; ti.mtime = int(st.st_mtime); ti.mode = 0o600
            with open(src, "rb") as f:
                tar.addfile(ti, f)
        del rec["scratch_path"]
        entries.append(rec)
        print(f"  + {e['member']} ({rec['payload_size']} B)", file=sys.stderr)
zst.stdin.close()
if zst.wait() != 0:
    sys.exit("zstd failed")

# verification pass: stream the archive back and hash every member
expect = {r["member"]: r["payload_sha256"] for r in entries}
seen = {}
dz = subprocess.Popen(["zstd", "-q", "-dc", "--long=30", out], stdout=subprocess.PIPE)
with tarfile.open(fileobj=dz.stdout, mode="r|") as tar:
    for m in tar:
        f = tar.extractfile(m)
        h = hashlib.sha256()
        for c in iter(lambda: f.read(8 << 20), b""):
            h.update(c)
        seen[m.name] = h.hexdigest()
if dz.wait() != 0:
    sys.exit("zstd -d failed")
bad = [k for k in expect if seen.get(k) != expect[k]]
if bad or len(seen) != len(expect):
    sys.exit(f"VERIFY FAILED: {bad[:5]} seen={len(seen)} expect={len(expect)}")
os.chmod(out, 0o600)
manifest = {"archive": os.path.basename(out), "archive_sha256": sha(out), "archive_size": os.path.getsize(out),
            "format": "tar (PAX) compressed with zstd --long=30; decompress with: zstd -d --long=30",
            "verified": "every member re-read from the archive and sha256-matched", "members": entries}
json.dump(manifest, open(man_path, "w"), indent=1)
os.chmod(man_path, 0o600)
print(json.dumps({"archive": out, "members": len(entries), "size": manifest["archive_size"],
                  "input_bytes": sum(r["original_size"] for r in entries),
                  "payload_bytes": sum(r["payload_size"] for r in entries)}))
