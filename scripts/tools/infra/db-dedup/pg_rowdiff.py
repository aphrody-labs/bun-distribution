#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Row-level comparison of two databases on the local cluster (port 5432).

usage: pg_rowdiff.py LOCAL_DB REFERENCE_DB
For every user table present in LOCAL_DB, hashes each row as md5(to_jsonb(row))
in both DBs (session TimeZone=UTC) and reports rows only in LOCAL (not present
in REFERENCE) and rows only in REFERENCE. JSON on stdout.
"""
import json, os, subprocess, sys

L, R = sys.argv[1], sys.argv[2]
env = dict(os.environ, PGTZ="UTC", PGOPTIONS="-c TimeZone=UTC -c extra_float_digits=3")

def psql(db, sql):
    r = subprocess.run(["sudo", "-n", "-E", "-u", "postgres", "psql", "-X", "-At", "-F", "\t", "-d", db, "-c", sql],
                       capture_output=True, text=True, env=env)
    if r.returncode:
        raise RuntimeError(r.stderr[-300:])
    return [l.split("\t") for l in r.stdout.splitlines() if l]

def tables(db):
    return {f"{n}.{t}" for n, t in psql(db, """select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'""")}

def hashes(db, fq):
    n, t = fq.split(".", 1)
    r = subprocess.run(["sudo", "-n", "-E", "-u", "postgres", "psql", "-X", "-At", "-d", db, "-c",
                        f'COPY (SELECT md5(to_jsonb(x)::text) FROM "{n}"."{t}" x) TO STDOUT'],
                       capture_output=True, text=True, env=env)
    if r.returncode:
        raise RuntimeError(r.stderr[-300:])
    from collections import Counter
    return Counter(r.stdout.split())

tl, tr = tables(L), tables(R)
out = {"local": L, "reference": R, "tables_only_local": sorted(tl - tr), "tables_only_reference": sorted(tr - tl), "per_table": {}}
tot_l = tot_r = 0
for fq in sorted(tl & tr):
    try:
        a, b = hashes(L, fq), hashes(R, fq)
    except Exception as e:
        out["per_table"][fq] = {"error": str(e)}
        continue
    only_l = sum((a - b).values())
    only_r = sum((b - a).values())
    tot_l += only_l; tot_r += only_r
    if only_l or only_r:
        out["per_table"][fq] = {"rows_local": sum(a.values()), "rows_reference": sum(b.values()),
                                "only_local": only_l, "only_reference": only_r}
for fq in sorted(tl - tr):
    n, t = fq.split(".", 1)
    c = int(psql(L, f'select count(*) from "{n}"."{t}"')[0][0])
    out["per_table"][fq] = {"rows_local": c, "only_local": c, "table_missing_in_reference": True}
    tot_l += c
out["total_only_local"] = tot_l
out["total_only_reference"] = tot_r
out["local_is_subset_of_reference"] = (tot_l == 0)
json.dump(out, sys.stdout, indent=1)
