#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Qualify and add Shenron's existing SQLite chunks to its private PG schema."""

import argparse
import csv
import hashlib
import json
import os
import pathlib
import pwd
import shutil
import sqlite3
import subprocess
import urllib.parse
import uuid

ROOT = pathlib.Path("/home/ubuntu/apps/shenron")
SOURCE = ROOT / "shared/bot/data/bot.db"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def qualify(row):
    rowid, title, url, content, kind, lang, origin, entity = row
    if (
        not isinstance(rowid, int)
        or rowid < 1
        or not title
        or not title.strip()
        or not content
        or not content.strip()
        or not kind
        or not kind.strip()
    ):
        raise ValueError("incomplete source chunk")
    if not url or not url.strip():
        raise ValueError("source URL required")
    url = urllib.parse.urljoin("https://dragonballfr.com", url)
    parsed = urllib.parse.urlsplit(url)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.hostname == "fandom.com"
        or parsed.hostname.endswith(".fandom.com")
    ):
        raise ValueError("unsupported editorial source")
    for value, limit in (
        (title, 1024),
        (content, 512 * 1024),
        (url, 2048),
        (kind, 64),
        (lang, 32),
        (origin, 256),
        (entity, 256),
    ):
        if value is not None and len(value.encode()) > limit:
            raise ValueError("source chunk exceeds ingestion contract")
    metadata = {
        "kind": kind,
        **({"lang": lang} if lang else {}),
        **({"originSourceId": origin} if origin else {}),
        **({"entity": entity} if entity else {}),
    }
    return [
        "shenron",
        f"shenron:{rowid}",
        title,
        url,
        content,
        json.dumps(metadata, ensure_ascii=False),
    ]


def psql(sql):
    result = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            "-u",
            "postgres",
            "shenron-postgres",
            "/usr/lib/postgresql/18/bin/psql",
            "-d",
            "shenron_site",
            "-v",
            "ON_ERROR_STOP=1",
            "-At",
        ],
        input=sql,
        text=True,
        capture_output=True,
        timeout=300,
        check=False,
    )
    if result.returncode:
        raise RuntimeError("private corpus SQL operation failed; source retained")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", required=True, type=pathlib.Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("root required; source and exports remain private")
    release = json.loads((ROOT / "current/release.json").read_text())
    if release.get("target") != "dbfr":
        parser.error("DBFR release required")
    manifest = json.loads((args.checkout / "SOURCE-MANIFEST.json").read_text())
    relative = "crates/ai/rag/migrations/0001_shenron_postgres.sql"
    migration = args.checkout / relative
    if digest(migration) != manifest["files"][relative]:
        parser.error("committed migration checksum mismatch")
    connection = sqlite3.connect(f"file:{SOURCE}?mode=ro", uri=True)
    connection.execute("BEGIN")
    columns = "rowid,title,url,content,kind,lang,source_id,entity"
    total = connection.execute("SELECT count(*) FROM rag_chunks").fetchone()[0]
    count = 0
    for row in connection.execute(f"SELECT {columns} FROM rag_chunks ORDER BY rowid"):
        qualify(row)
        count += 1
    if total < 1 or count != total:
        raise ValueError("nonempty complete source snapshot required")
    if not args.apply:
        print(
            json.dumps(
                {
                    "plan": "Add qualified existing chunks to private shenron_compute schema; no source changes, no retirement, no training",
                    "sourceChunks": total,
                    "qualifiedChunks": count,
                    "writes": 0,
                }
            )
        )
        return
    # The backup owner verifies every artifact before publishing VERIFIED.json.
    backups = ROOT / "shared/backups/container"
    verified = sorted(backups.glob("*/VERIFIED.json"))
    if not verified:
        raise ValueError("qualified database backup required")
    backup = verified[-1]
    b = json.loads(backup.read_text())
    for relative, checksum in b["files"].items():
        path = backup.parent / relative
        if (
            not path.resolve().is_relative_to(backup.parent.resolve())
            or digest(path) != checksum
        ):
            raise ValueError("retained backup artifact checksum mismatch")
    os.umask(0o077)
    unique = uuid.uuid4().hex
    exports = ROOT / "shared/agent-home/corpus/exports"
    exports.mkdir(parents=True, mode=0o700, exist_ok=True)
    output = exports / (unique + ".csv")
    with output.open("x", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["corpus", "entity_id", "title", "url", "content", "metadata"])
        for row in connection.execute(
            f"SELECT {columns} FROM rag_chunks ORDER BY rowid"
        ):
            writer.writerow(qualify(row))
        stream.flush()
        os.fsync(stream.fileno())
    connection.close()
    # COPY from a protected file avoids psql's line-based \. marker ambiguity
    # for multiline content. The only temporary PG file is unique to this run.
    temporary = (
        ROOT / "shared/state/postgres/data" / (".shenron-import-" + unique + ".csv")
    )
    shutil.copyfile(output, temporary)
    temporary.chmod(0o600)
    os.chown(temporary, 105, 111)
    if digest(output) != digest(temporary):
        raise ValueError("private PG import copy checksum mismatch")
    private = pathlib.Path("/etc/aphrody/shenron-compute.env")
    environment = {
        line.split("=", 1)[0]: json.loads(line.split("=", 1)[1])
        for line in private.read_text().splitlines()
        if "=" in line
    }
    user = urllib.parse.unquote(
        urllib.parse.urlsplit(environment["APHRODY_MCP_DATABASE_URL"]).username or ""
    )
    if not user:
        raise ValueError("qualified PG caller role required")
    role = '"' + user.replace('"', '""') + '"'
    sql = (
        "BEGIN;\nCREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;\nCREATE SCHEMA IF NOT EXISTS shenron_compute AUTHORIZATION "
        + role
        + ";\nSET LOCAL search_path TO shenron_compute,public;\n"
        + migration.read_text()
    )
    sql += "\nCREATE TEMP TABLE shenron_import_stage (LIKE aphrody_rag_documents INCLUDING DEFAULTS);\n"
    sql += (
        "GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA shenron_compute TO "
        + role
        + ";\n"
    )
    sql += (
        "COPY shenron_import_stage(corpus,entity_id,title,url,content,metadata) FROM '/var/lib/postgresql/data/"
        + temporary.name
        + "' WITH (FORMAT csv, HEADER true);\n"
    )
    sql += "INSERT INTO aphrody_rag_documents(corpus,entity_id,title,url,content,metadata) SELECT corpus,entity_id,title,url,content,metadata FROM shenron_import_stage ON CONFLICT(corpus,entity_id) DO UPDATE SET title=EXCLUDED.title,url=EXCLUDED.url,content=EXCLUDED.content,metadata=EXCLUDED.metadata,updated_at=CASE WHEN aphrody_rag_documents.title IS DISTINCT FROM EXCLUDED.title OR aphrody_rag_documents.content IS DISTINCT FROM EXCLUDED.content THEN now() ELSE aphrody_rag_documents.updated_at END;\n"
    sql += (
        "DO $$ BEGIN IF (SELECT count(*) FROM shenron_import_stage s JOIN aphrody_rag_documents d USING(corpus,entity_id) WHERE s.title=d.title AND s.content=d.content AND s.url IS NOT DISTINCT FROM d.url AND s.metadata=d.metadata) <> "
        + str(total)
        + " THEN RAISE EXCEPTION 'corpus verification failed'; END IF; END $$;\nCOMMIT;\n"
    )
    psql(sql)
    temporary.unlink()
    receipt = {
        "sourceChunks": total,
        "verifiedImportedChunks": total,
        "csvSha256": digest(output),
        "sourceRepoCommit": manifest["sourceCommit"],
        "sourceRetained": True,
        "training": False,
        "backupManifest": str(backup),
    }
    output.with_suffix(".VERIFIED.json").write_text(
        json.dumps(receipt, indent=2) + "\n"
    )
    owner = pwd.getpwnam("ubuntu")
    for path in (
        ROOT / "shared/agent-home/corpus",
        exports,
        output,
        output.with_suffix(".VERIFIED.json"),
    ):
        os.chown(path, owner.pw_uid, owner.pw_gid)
    print(json.dumps(receipt))


if __name__ == "__main__":
    try:
        main()
    except (
        OSError,
        ValueError,
        KeyError,
        RuntimeError,
        sqlite3.Error,
        subprocess.SubprocessError,
    ):
        raise SystemExit(
            "Private Shenron corpus qualification/import failed; source retained, no contents logged"
        ) from None
