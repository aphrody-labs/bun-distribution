#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Delete files only when every safety check passes. Run as root.

stdin: JSON list of {"path", "sha256", "reason", "evidence"}; "sha256" is the
content hash that is proven present in the unique backup. Checks per file:
exists, regular file, sha256 matches, not git-tracked, not open (fuser), not
named in any systemd unit. Prints a JSON log on stdout; never raises on a
refused file (it is kept and reported).
"""
import hashlib, json, os, subprocess, sys

items = json.load(sys.stdin)
units = subprocess.run("cat /etc/systemd/system/*.service /etc/systemd/system/*.timer /lib/systemd/system/*.service 2>/dev/null",
                       shell=True, capture_output=True, text=True).stdout
log = []
for it in items:
    p = it["path"]; rec = dict(it); rec["action"] = "kept"
    try:
        st = os.lstat(p)
    except FileNotFoundError:
        rec["result"] = "absent"; log.append(rec); continue
    if not os.path.isfile(p) or os.path.islink(p):
        rec["result"] = "not a regular file"; log.append(rec); continue
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(8 << 20), b""):
            h.update(c)
    rec["size"], rec["nlink"] = st.st_size, st.st_nlink
    if h.hexdigest() != it["sha256"]:
        rec["result"] = f"sha256 mismatch ({h.hexdigest()[:12]})"; log.append(rec); continue
    g = subprocess.run(["git", "-c", "safe.directory=*", "-C", os.path.dirname(p), "ls-files", "--error-unmatch", os.path.basename(p)], capture_output=True)
    if g.returncode == 0:
        rec["result"] = "git-tracked"; log.append(rec); continue
    fu = subprocess.run(["fuser", p], capture_output=True, text=True)
    if fu.stdout.strip():
        rec["result"] = f"open by pid {fu.stdout.strip()}"; log.append(rec); continue
    if p in units:
        rec["result"] = "referenced by a systemd unit"; log.append(rec); continue
    os.unlink(p)
    rec["action"] = "deleted"; rec["result"] = "ok"
    rec["bytes_reclaimed"] = st.st_size if st.st_nlink == 1 else 0
    log.append(rec)
json.dump(log, sys.stdout, indent=1)
print(f"\n# deleted={sum(r['action']=='deleted' for r in log)} kept={sum(r['action']=='kept' for r in log)} "
      f"reclaimed={sum(r.get('bytes_reclaimed',0) for r in log)}", file=sys.stderr)
