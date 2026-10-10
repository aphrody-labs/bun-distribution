#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""DB/dump inventory for one host. Run as root (sudo). Emits JSON on stdout.

Input: tab-separated find output on stdin (size, mtime, inode:links, path).
No credentials are read or emitted: Postgres is reached through the local
peer-authenticated postgres superuser socket.
"""
import gzip, hashlib, json, os, re, socket, sqlite3, subprocess, sys

HOST = sys.argv[1] if len(sys.argv) > 1 else socket.gethostname()
SKIP_HASH_OVER = int(os.environ.get("SKIP_HASH_OVER", str(50 * 1024**3)))

EXCLUDE = [
    (r"/\.local/share/containers/|/var/lib/containers/", "container layers"),
    (r"/\.camoufox/|/google-chrome|/chrome-data/|/\.mozilla/|/chromium/", "browser profile"),
    (r"/pki/nssdb/|/\.pki/", "certificate store (secret material)"),
    (r"/\.config/gcloud/", "cloud credentials store (secret material)"),
    (r"/var/lib/(fail2ban|PackageKit|vnstat|fwupd)/", "system database"),
    (r"/hsts-storage\.sqlite$", "webview cache"),
    (r"^/opt/ghidra|/linuxbrew/", "vendored tool archive"),
    (r"/\.codex/|/\.gemini/", "agent conversation store"),
    (r"/storage/request_queues/", "crawler request queue (transient)"),
]

def excluded(path):
    for rx, why in EXCLUDE:
        if re.search(rx, path):
            return why
    return None

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def magic(path):
    with open(path, "rb") as f:
        head = f.read(16)
    if head.startswith(b"SQLite format 3\0"):
        return "sqlite"
    if head.startswith(b"PGDMP"):
        return "pg_custom"
    if head[:2] == b"\x1f\x8b":
        return "gzip"
    if head[:4] == b"\x28\xb5\x2f\xfd":
        return "zstd"
    if head[:4] == b"PK\x03\x04":
        return "zip"
    return "other"

def git_tracked(path):
    d = os.path.dirname(path)
    try:
        r = subprocess.run(["git", "-c", "safe.directory=*", "-C", d, "ls-files", "--error-unmatch", os.path.basename(path)],
                           capture_output=True, timeout=20)
        return r.returncode == 0
    except Exception:
        return False

def sqlite_info(path):
    info = {}
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30)
        con.execute("PRAGMA query_only=1")
        tables = [r[0] for r in con.execute(
            "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")]
        counts = {}
        for t in tables:
            try:
                counts[t] = con.execute(f'select count(*) from "{t}"').fetchone()[0]
            except Exception as e:
                counts[t] = f"error: {e}"
        info["tables"] = len(tables)
        info["row_counts"] = counts
        info["total_rows"] = sum(v for v in counts.values() if isinstance(v, int))
        info["schema_sha256"] = hashlib.sha256("\n".join(
            r[0] or "" for r in con.execute("select sql from sqlite_master order by type,name")).encode()).hexdigest()
        ic = [r[0] for r in con.execute("PRAGMA integrity_check")]
        info["integrity_check"] = "ok" if ic == ["ok"] else ic[:20]
        con.close()
    except Exception as e:
        info["error"] = str(e)
    return info

def pg_custom_info(path):
    r = subprocess.run(["pg_restore", "--list", path], capture_output=True, text=True)
    if r.returncode != 0:
        return {"pg_restore_list": "FAILED", "error": r.stderr[-500:]}
    lines = r.stdout.splitlines()
    meta = {"pg_restore_list": "ok"}
    for l in lines:
        m = re.match(r";\s+(Archive created at|dbname|TOC Entries|Dumped from database version|Dumped by pg_dump version|Compression):\s*(.*)", l)
        if m:
            meta[m.group(1)] = m.group(2).strip()
    meta["table_data_entries"] = sum(1 for l in lines if " TABLE DATA " in l)
    return meta

def gzip_info(path):
    info = {}
    try:
        with gzip.open(path, "rb") as f:
            head = f.read(4096)
        if head.startswith(b"SQLite format 3\0"):
            info["inner"] = "sqlite"
        elif b"PostgreSQL database dump" in head:
            info["inner"] = "pg_plain_sql"
            m = re.search(rb"Dumped from database version ([^\n]+)", head)
            if m: info["Dumped from database version"] = m.group(1).decode()
        elif head[257:262] == b"ustar":
            info["inner"] = "tar"
        else:
            info["inner"] = "other"
        r = subprocess.run(["gzip", "-t", path], capture_output=True)
        info["gzip_test"] = "ok" if r.returncode == 0 else r.stderr.decode()[-200:]
    except Exception as e:
        info["error"] = str(e)
    if info.get("inner") == "tar":
        r = subprocess.run(["tar", "-tzvf", path], capture_output=True, text=True)
        info["tar_members"] = r.stdout.splitlines()[:200]
    return info

def files_inventory():
    out = []
    for line in sys.stdin:
        line = line.rstrip("\n")
        if not line:
            continue
        size, mtime, inode, path = line.split("\t", 3)
        why = excluded(path)
        if why:
            continue
        size = int(size)
        rec = {"host": HOST, "path": path, "size": size, "mtime": mtime, "inode_links": inode}
        try:
            rec["kind"] = magic(path)
        except Exception as e:
            rec["kind"] = f"unreadable: {e}"
            out.append(rec); continue
        if path.endswith(".sql") or rec["kind"] == "other":
            tracked = git_tracked(path)
            rec["git_tracked"] = tracked
            if tracked and size < 5 * 1024 * 1024:
                continue  # schema/migration source, not data
        else:
            rec["git_tracked"] = git_tracked(path)
        rec["sha256"] = sha256(path) if size <= SKIP_HASH_OVER else None
        if rec["kind"] == "sqlite":
            rec["sqlite"] = sqlite_info(path)
        elif rec["kind"] == "pg_custom":
            rec["pg_dump"] = pg_custom_info(path)
        elif rec["kind"] == "gzip":
            rec["gzip"] = gzip_info(path)
        out.append(rec)
    return out

def psql(db, sql, port=None):
    cmd = ["sudo", "-n", "-u", "postgres", "psql", "-X", "-At", "-F", "\t", "-d", db, "-c", sql]
    if port:
        cmd[5:5] = ["-p", str(port)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[-400:])
    return [l.split("\t") for l in r.stdout.splitlines() if l]

def pg_inventory(port=5432):
    dbs = []
    for (name, size) in psql("postgres", "select datname, pg_database_size(datname) from pg_database where not datistemplate and datname<>'postgres' order by 1", port):
        d = {"host": HOST, "port": port, "db": name, "size": int(size)}
        rows = psql(name, """select n.nspname, c.relname, coalesce(s.n_live_tup,0)
            from pg_class c join pg_namespace n on n.oid=c.relnamespace
            left join pg_stat_user_tables s on s.relid=c.oid
            where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'
            order by 1,2""", port)
        tables = {}
        for nsp, rel, live in rows:
            fq = f'{nsp}.{rel}'
            try:
                cnt = int(psql(name, f'select count(*) from "{nsp}"."{rel}"', port)[0][0])
            except Exception as e:
                cnt = f"error: {e}"
            tables[fq] = {"rows": cnt, "n_live_tup": int(live)}
        ts_cols = psql(name, """select table_schema, table_name, column_name from information_schema.columns
            where data_type like 'timestamp%' and table_schema not in ('pg_catalog','information_schema')
              and (column_name ~ '(created|updated|inserted|modified)' or column_name in ('ts','timestamp','date'))
            order by 1,2,3""", port)
        for nsp, rel, col in ts_cols:
            fq = f'{nsp}.{rel}'
            if fq not in tables:
                continue
            try:
                v = psql(name, f'select max("{col}")::text from "{nsp}"."{rel}"', port)
                tables[fq].setdefault("max_ts", {})[col] = v[0][0] if v and v[0] and v[0][0] else None
            except Exception:
                pass
        d["tables"] = len(tables)
        d["schemas"] = sorted({k.split(".")[0] for k in tables})
        d["sum_rows"] = sum(t["rows"] for t in tables.values() if isinstance(t["rows"], int))
        d["sum_n_live_tup"] = sum(t["n_live_tup"] for t in tables.values())
        d["per_table"] = tables
        dbs.append(d)
    return dbs

if __name__ == "__main__":
    mode = os.environ.get("MODE", "all")
    res = {"host": HOST}
    if mode in ("all", "pg"):
        ports = [int(p) for p in os.environ.get("PG_PORTS", "5432").split(",")]
        res["postgres"] = []
        for p in ports:
            res["postgres"] += pg_inventory(p)
    if mode in ("all", "files"):
        res["files"] = files_inventory()
    json.dump(res, sys.stdout, indent=1, default=str)
