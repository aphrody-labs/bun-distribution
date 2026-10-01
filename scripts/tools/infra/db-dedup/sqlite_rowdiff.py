#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Row-level containment check between two SQLite files.

usage: sqlite_rowdiff.py OLD.db REFERENCE.db
Reports, per table of OLD, the number of rows of OLD that are absent from
REFERENCE (compared over OLD's columns; a column missing in REFERENCE counts
as a difference for rows where it is non-NULL). JSON on stdout.
"""
import json, sqlite3, sys

old, ref = sys.argv[1], sys.argv[2]
con = sqlite3.connect(f"file:{old}?mode=ro", uri=True)
con.execute(f"ATTACH DATABASE 'file:{ref}?mode=ro' AS ref")

def cols(schema, t):
    return [r[1] for r in con.execute(f'PRAGMA {schema}.table_info("{t}")')]

def tables(schema):
    return [r[0] for r in con.execute(
        f"select name from {schema}.sqlite_master where type='table' and name not like 'sqlite_%' and coalesce(sql,'') not like 'CREATE VIRTUAL TABLE%' order by name")]

ref_tables = set(tables("ref"))
res = {"old": old, "reference": ref, "per_table": {}}
total = 0
for t in tables("main"):
    oc = cols("main", t)
    n_old = con.execute(f'select count(*) from main."{t}"').fetchone()[0]
    if t not in ref_tables:
        if n_old:
            res["per_table"][t] = {"rows_old": n_old, "only_old": n_old, "table_missing_in_reference": True}
        total += n_old
        continue
    rc = set(cols("ref", t))
    shared = [c for c in oc if c in rc]
    missing = [c for c in oc if c not in rc]
    q_shared = ", ".join(f'"{c}"' for c in shared)
    if not shared:
        diff = n_old
    else:
        diff = con.execute(f'select count(*) from (select {q_shared} from main."{t}" except select {q_shared} from ref."{t}")').fetchone()[0]
    lost = 0
    for c in missing:
        lost = max(lost, con.execute(f'select count(*) from main."{t}" where "{c}" is not null').fetchone()[0])
    d = max(diff, lost)
    total += d
    if d:
        res["per_table"][t] = {"rows_old": n_old, "only_old": d, "columns_missing_in_reference": missing}
res["total_only_old"] = total
res["old_is_subset_of_reference"] = (total == 0)
json.dump(res, sys.stdout, indent=1)
