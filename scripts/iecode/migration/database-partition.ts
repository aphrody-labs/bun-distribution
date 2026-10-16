import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const POSTGRES_IMAGE = "postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873";
const identifier = '"(?:[^"\\n]|"")*"|[A-Za-z_][A-Za-z_0-9$]*';
const relationPattern = new RegExp(`(${identifier})\\s*\\.\\s*(${identifier})`, "g");
const kinds = [
  "SCHEMA",
  "EXTENSION",
  "TYPE",
  "DOMAIN",
  "FUNCTION",
  "PROCEDURE",
  "AGGREGATE",
  "TABLE",
  "TABLE DATA",
  "SEQUENCE",
  "SEQUENCE SET",
  "SEQUENCE OWNED BY",
  "VIEW",
  "MATERIALIZED VIEW",
  "MATERIALIZED VIEW DATA",
  "INDEX",
  "CONSTRAINT",
  "FK CONSTRAINT",
  "TRIGGER",
  "RULE",
  "POLICY",
  "ROW SECURITY",
  "DEFAULT",
  "ACL",
  "DEFAULT ACL",
  "COMMENT",
  "SECURITY LABEL",
  "DATABASE",
  "DATABASE PROPERTIES",
  "CAST",
  "COLLATION",
  "TABLE ATTACH",
  "INDEX ATTACH",
];
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export function clientTransport(conninfo: string) {
  const fields = new Map<string, string>();
  for (const line of conninfo.trim().split(/\r?\n/)) {
    if (!line.startsWith("SSL ")) continue;
    const [name, value, extra] = line.split(",");
    if (!name || value === undefined || extra !== undefined || fields.has(name))
      throw new Error("Invalid client SSL connection metadata");
    fields.set(name, value);
  }
  const protocol = fields.get("SSL Protocol");
  const cipher = fields.get("SSL Cipher");
  const keyBits = Number(fields.get("SSL Key Bits"));
  if (
    fields.get("SSL Connection") !== "true" ||
    !protocol ||
    !/^TLSv1\.[23]$/.test(protocol) ||
    !cipher ||
    !Number.isInteger(keyBits) ||
    keyBits < 128
  )
    throw new Error("Verified client TLS connection metadata required");
  return { protocol, cipher, keyBits, conninfoSha256: digest(conninfo) };
}

const unquote = (value: string) => (value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value);
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
type Owner = "game" | "rg" | "shared";
export interface TableMetadata {
  schema: string;
  name: string;
  rowCount: number;
}
interface HistoryEvidence {
  sourceSha256: string;
  rows: number;
  technicalFamilyMatches: Record<string, number>;
  rawValuesExported: false;
}
interface SqlBlock {
  name: string;
  kind: string;
  schema: string;
  body: string;
}
export interface ArchiveEntry {
  id: number;
  kind: string;
  schema: string;
  name: string;
  owner: Owner;
  sourceLine: string;
  sourceLineSha256: string;
  ddlSha256?: string;
  parentRelation?: string;
  references: string[];
  functionReferences: string[];
  disposition: "restore" | "privileges-held" | "policy-rewrite";
}
const gameTable = (schema: string, name: string) =>
  schema === "public" && (name.startsWith("inagle_") || name === "niers_schema_migrations");

export function sqlBlocks(sql: string): Map<number, SqlBlock> {
  const result = new Map<number, SqlBlock>();
  for (const match of sql.matchAll(/^-- TOC entry (\d+) \(.*?\)\n([\s\S]*?)(?=^-- TOC entry |$(?![\s\S]))/gm)) {
    const header = /^-- Name: (.*); Type: (.*); Schema: (.*); Owner: (.*)$/m.exec(match[2]!);
    if (!header) throw new Error("Missing archive schema metadata header");
    const id = Number(match[1]);
    if (result.has(id)) throw new Error("Duplicate schema TOC identifier");
    result.set(id, { name: header[1]!, kind: header[2]!, schema: header[3]!, body: match[2]! });
  }
  return result;
}

export function partitionArchive(input: {
  toc: string;
  schemaSql: string;
  tables: TableMetadata[];
  sourceSha256: string;
  history: HistoryEvidence;
  expectedEntries: number;
}) {
  if (
    !/^[a-f0-9]{64}$/.test(input.sourceSha256) ||
    input.history.sourceSha256 !== input.sourceSha256 ||
    input.history.rawValuesExported !== false ||
    input.history.rows !==
      (input.tables.find(t => t.schema === "public" && t.name === "niers_schema_migrations")?.rowCount ?? 0) ||
    input.history.technicalFamilyMatches.inagle !== input.history.rows
  )
    throw new Error("Inagle migration-history ownership evidence does not match the source");
  const blocks = sqlBlocks(input.schemaSql);
  const allKinds = [...new Set([...kinds, ...[...blocks.values()].map(b => b.kind)])].sort(
    (a, b) => b.length - a.length,
  );
  const pattern = new RegExp(`^(\\d+);\\s+\\d+\\s+\\d+\\s+(${allKinds.join("|")})\\s+(\\S+)\\s+(.*)$`);
  const tables = new Map(input.tables.map(t => [`${t.schema}.${t.name}`, t]));
  const ids = new Set<number>();
  const entries: ArchiveEntry[] = [];
  const bodies = new Map<number, string>();
  for (const line of input.toc.split(/\r?\n/)) {
    if (!/^\d+;/.test(line)) continue;
    const match = pattern.exec(line);
    if (!match) throw new Error("Unknown TOC description");
    const id = Number(match[1]);
    if (ids.has(id)) throw new Error("Duplicate TOC identifier");
    ids.add(id);
    const block = blocks.get(id);
    const kind = block?.kind ?? match[2]!;
    const schema = block?.schema ?? match[3]!;
    const name = block?.name ?? match[4]!.replace(/\s+[^ ]*$/, "");
    const body = block?.body ?? "";
    bodies.set(id, body);
    const references = [
      ...new Set(
        [...body.matchAll(relationPattern)]
          .map(m => `${unquote(m[1]!)}.${unquote(m[2]!)}`)
          .filter(key => tables.has(key)),
      ),
    ].sort();
    let parentRelation = kind === "TABLE" || kind === "TABLE DATA" ? `${schema}.${unquote(name)}` : undefined;
    const anchor = new RegExp(
      `(?:ALTER TABLE (?:ONLY )?|\\bON (?:ONLY )?|\\bOWNED BY )(${identifier})\\s*\\.\\s*(${identifier})`,
    ).exec(body);
    if (anchor && tables.has(`${unquote(anchor[1]!)}.${unquote(anchor[2]!)}`))
      parentRelation = `${unquote(anchor[1]!)}.${unquote(anchor[2]!)}`;
    if (
      !parentRelation &&
      [
        "ACL",
        "COMMENT",
        "ROW SECURITY",
        "POLICY",
        "CONSTRAINT",
        "FK CONSTRAINT",
        "INDEX",
        "TRIGGER",
        "RULE",
        "DEFAULT",
      ].includes(kind)
    ) {
      const first = name
        .replace(/^(TABLE|COLUMN|SEQUENCE) /, "")
        .split(" ")[0]!
        .split(".")[0]!;
      if (tables.has(`${schema}.${unquote(first)}`)) parentRelation = `${schema}.${unquote(first)}`;
    }
    if (kind === "TABLE DATA" && (!parentRelation || !tables.has(parentRelation)))
      throw new Error("Uninventoried table data in archive");
    const namespace = schema === "-" && kind === "SCHEMA" ? unquote(name) : schema;
    let owner: Owner = parentRelation
      ? gameTable(...(parentRelation.split(".") as [string, string]))
        ? "game"
        : "rg"
      : namespace === "public" && name.startsWith("inagle_")
        ? "game"
        : "rg";
    if (
      (schema === "-" && ["SCHEMA", "COMMENT"].includes(kind) && /^(SCHEMA )?(public|extensions)$/.test(name)) ||
      kind === "EXTENSION" ||
      (kind === "COMMENT" && name.startsWith("EXTENSION "))
    )
      owner = "shared";
    const functionReferences = [
      ...new Set([...body.matchAll(/\b(auth\.[A-Za-z_][A-Za-z_0-9]*|public\.is_admin)\s*\(/g)].map(m => m[1]!)),
    ].sort();
    let disposition: ArchiveEntry["disposition"] = ["ACL", "DEFAULT ACL"].includes(kind)
      ? "privileges-held"
      : "restore";
    if (owner === "game" && kind === "POLICY") {
      const statement = /CREATE POLICY [\s\S]*?;/.exec(body)?.[0] ?? "";
      const roles = /\bTO\s+([^;]+?)(?:\s+(?:USING|WITH CHECK)|;)/.exec(statement)?.[1]?.trim();
      if ((roles && roles.toLowerCase() !== "public") || functionReferences.length) disposition = "policy-rewrite";
    }
    entries.push({
      id,
      kind,
      schema,
      name,
      owner,
      sourceLine: line,
      sourceLineSha256: digest(line),
      ...(block ? { ddlSha256: digest(body) } : {}),
      ...(parentRelation ? { parentRelation } : {}),
      references,
      functionReferences,
      disposition,
    });
  }
  if (entries.length !== input.expectedEntries) throw new Error("TOC coverage does not match the pinned archive");
  const sequenceOwners = new Map(
    entries.filter(e => e.kind === "SEQUENCE OWNED BY").map(e => [`${e.schema}.${e.name}`, e.owner]),
  );
  for (const e of entries)
    if (["SEQUENCE", "SEQUENCE SET"].includes(e.kind)) {
      const key = `${e.schema}.${e.name}`;
      e.owner = sequenceOwners.get(key) ?? (e.name.startsWith("inagle_") ? "game" : "rg");
    }
  const allowlist = (owner: "game" | "rg") =>
    entries.filter(
      e =>
        e.disposition === "restore" &&
        (e.owner === owner ||
          (e.owner === "shared" && (owner === "rg" || (e.kind === "SCHEMA" && e.name === "public")))),
    );
  const gameEntries = allowlist("game");
  const rgEntries = allowlist("rg");
  const gameData = gameEntries.filter(e => e.kind === "TABLE DATA");
  const rgData = rgEntries.filter(e => e.kind === "TABLE DATA");
  if (
    gameData.length + rgData.length !== input.tables.length ||
    new Set([...gameData, ...rgData].map(e => e.id)).size !== input.tables.length ||
    new Set([...gameData, ...rgData].map(e => e.parentRelation)).size !== input.tables.length ||
    [...tables.keys()].some(key => ![...gameData, ...rgData].some(e => e.parentRelation === key))
  )
    throw new Error("Data partitions must cover each table exactly once");
  const crossStoreDependencies = entries
    .map(e => ({
      id: e.id,
      kind: e.kind,
      owner: e.owner,
      disposition: e.disposition,
      relations: e.references.filter(
        key => (gameTable(...(key.split(".") as [string, string])) ? "game" : "rg") !== e.owner,
      ),
      functions: e.owner === "game" ? e.functionReferences : [],
      confidence: "INFERRED" as const,
    }))
    .filter(e => e.relations.length || e.functions.length);
  if (crossStoreDependencies.some(e => e.owner === "game" && e.disposition === "restore"))
    throw new Error("Unresolved game cross-store dependency requires an explicit owner rewrite");
  const readerPolicies: string[] = [];
  const policyRewrites: {
    id: number;
    table: string;
    sourceSha256: string;
    target: "reader" | "writer" | "importer";
    targetSha256?: string;
  }[] = [];
  const writerTables = new Set<string>();
  const importerTables = new Set<string>();
  for (const e of entries.filter(e => e.disposition === "policy-rewrite")) {
    const statement = /CREATE POLICY [\s\S]*?;/.exec(bodies.get(e.id) ?? "")?.[0];
    if (!statement || !e.parentRelation) throw new Error("Policy rewrite requires an exact source relation and DDL");
    if (/\bFOR SELECT\b/.test(statement) && /USING \(true\)/.test(statement) && !e.functionReferences.length) {
      const target = statement.replace(/\bTO\s+[^;]+?(?=\s+USING)/, "TO inagle_reader");
      readerPolicies.push(target);
      policyRewrites.push({
        id: e.id,
        table: e.parentRelation,
        sourceSha256: digest(statement),
        target: "reader",
        targetSha256: digest(target),
      });
    } else {
      const importer = /^public\.inagle_(cpk_index|game_text)$/.test(e.parentRelation) && !e.functionReferences.length;
      (importer ? importerTables : writerTables).add(e.parentRelation);
      policyRewrites.push({
        id: e.id,
        table: e.parentRelation,
        sourceSha256: digest(statement),
        target: importer ? "importer" : "writer",
      });
    }
  }
  const roleSql = ["inagle_reader", "inagle_writer", "inagle_importer"]
    .map(role => `CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`)
    .join("\n");
  const scopedWrites = (role: string, names: Set<string>) =>
    [...names]
      .sort()
      .map(
        table =>
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${role};\nCREATE POLICY ${quote(role + "_backend_write")} ON ${table} FOR ALL TO ${role} USING (true) WITH CHECK (true);`,
      )
      .join("\n");
  const policySql = `${roleSql}\nGRANT USAGE ON SCHEMA public TO inagle_reader, inagle_writer, inagle_importer;\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO inagle_reader;\n${readerPolicies.join("\n")}\n${scopedWrites("inagle_writer", writerTables)}\n${scopedWrites("inagle_importer", importerTables)}\n`;
  const toc = (selected: ArchiveEntry[]) =>
    "; Owner partition; source privilege replay withheld.\n" + selected.map(e => e.sourceLine).join("\n") + "\n";
  const tablesWithOwner = input.tables.map(t => ({
    ...t,
    owner: gameTable(t.schema, t.name) ? ("game" as const) : ("rg" as const),
  }));
  return {
    schema: "iecode-database-owner-partition/2",
    sourceSha256: input.sourceSha256,
    tocSha256: digest(input.toc),
    schemaSha256: digest(input.schemaSql),
    coverageComplete: true,
    tocEntries: entries.length,
    entries,
    tables: tablesWithOwner,
    gameToc: toc(gameEntries),
    rgToc: toc(rgEntries),
    policySql,
    gameTocSha256: digest(toc(gameEntries)),
    rgTocSha256: digest(toc(rgEntries)),
    policySqlSha256: digest(policySql),
    policyRewrites,
    crossStoreDependencies,
    historyEvidence: input.history,
    securityBoundary:
      "No LOGIN roles, credentials, memberships or RG account/auth rows copied; privileged writes require explicit trusted service-role membership after RG staff authorization.",
    crossReferenceConfidence:
      "INFERRED lexical DDL references; validate the selected partition on actual PostgreSQL before cloud writes.",
    mirrorStrategy:
      "Keep the 54-table SQLite snapshot offline; optional import goes to a separate private staging schema, never UNION or replay onto the 227 canonical game projections.",
    cloudWritesApproved: false,
  };
}

async function boundedProcess(argv: string[], timeoutMs = 300_000) {
  const task = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 16 * 1024 * 1024) {
        task.kill();
        throw new Error("Bounded subprocess output limit exceeded");
      }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  const timer = setTimeout(() => task.kill(), timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([drain(task.stdout), drain(task.stderr), task.exited]);
    return {
      stdout,
      exitCode,
      diagnosticSha256: digest(stderr),
      sqlStates: [...new Set(stderr.match(/\b42501\b/g) ?? [])],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function prepare(directory: string) {
  const metadata = JSON.parse(await readFile(resolve(directory, "postgres-metadata.json"), "utf8"));
  if (digest(await readFile(resolve(directory, "rg.dump"))) !== metadata.source.sha256)
    throw new Error("Protected source archive hash mismatch");
  const result = partitionArchive({
    toc: await readFile(resolve(directory, "source.toc"), "utf8"),
    schemaSql: await readFile(resolve(directory, "source-schema.sql"), "utf8"),
    tables: metadata.tables,
    sourceSha256: metadata.source.sha256,
    expectedEntries: metadata.archive.tocEntryCount,
    history: JSON.parse(await readFile(resolve(directory, "migration-history-owner.json"), "utf8")),
  });
  for (const [name, value] of [
    ["neon-inagle.toc", result.gameToc],
    ["supabase-rg.toc", result.rgToc],
    ["neon-game-access.sql", result.policySql],
  ] as const) {
    await writeFile(resolve(directory, name), value, { mode: 0o600 });
    await chmod(resolve(directory, name), 0o600);
  }
  const { gameToc: _gameToc, rgToc: _rgToc, policySql: _policySql, ...manifest } = result;
  await writeFile(resolve(directory, "owner-partition-ts.json"), JSON.stringify(manifest, null, 2) + "\n", {
    mode: 0o600,
  });
  await writeFile(
    resolve(directory, "game-probe-plan.json"),
    JSON.stringify(
      {
        schema: "iecode-game-probe-plan/1",
        sourceSha256: result.sourceSha256,
        allowlistSha256: result.gameTocSha256,
        policySqlSha256: result.policySqlSha256,
        image: POSTGRES_IMAGE,
        network: "none",
        cpu: 1,
        memory: "2g",
        sourceMount: "read-only",
        persistentVolumes: false,
        cloudWrites: false,
        cleanup: "remove only the task-labelled ephemeral container",
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      tocEntries: result.tocEntries,
      tableCount: result.tables.length,
      owners: ["game", "rg"].map(owner => ({
        owner,
        tables: result.tables.filter(t => t.owner === owner).length,
        rows: result.tables.filter(t => t.owner === owner).reduce((total, t) => total + t.rowCount, 0),
      })),
      policyRewrites: result.policyRewrites.length,
      cloudWritesApproved: false,
    }),
  );
}

async function localProbe(directory: string) {
  if (process.platform !== "linux") throw new Error("Select the qualified native Docker host explicitly");
  const plan = JSON.parse(await readFile(resolve(directory, "game-probe-plan.json"), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(directory, "owner-partition-ts.json"), "utf8"));
  const metadata = JSON.parse(await readFile(resolve(directory, "postgres-metadata.json"), "utf8"));
  const archive = resolve(directory, "rg.dump");
  const toc = resolve(directory, "neon-inagle.toc");
  const policies = await readFile(resolve(directory, "neon-game-access.sql"), "utf8");
  if (
    plan.image !== POSTGRES_IMAGE ||
    plan.network !== "none" ||
    plan.cloudWrites !== false ||
    digest(await readFile(archive)) !== plan.sourceSha256 ||
    digest(await readFile(toc)) !== plan.allowlistSha256 ||
    digest(policies) !== plan.policySqlSha256
  )
    throw new Error("Local probe plan/source/allowlist/policy hashes do not match");
  const tables = manifest.tables.filter((t: TableMetadata & { owner: Owner }) => t.owner === "game") as TableMetadata[];
  const name = "iecode-game-probe-" + randomUUID().replaceAll("-", "").slice(0, 12);
  const exec = ["docker", "exec", "--user", `${process.getuid?.()}:${process.getgid?.()}`, name];
  const cleanup = async () => {
    const inspect = await boundedProcess(
      ["docker", "inspect", "--format", '{{index .Config.Labels "io.aphrody.task"}}', name],
      10_000,
    );
    if (inspect.stdout.trim() !== name) throw new Error("Task-labelled container ownership mismatch");
    const remove = await boundedProcess(["docker", "rm", "-f", name], 15_000);
    if (remove.exitCode) throw new Error("Owned PostgreSQL probe cleanup failed");
  };
  const query = async (sql: string) => {
    const result = await boundedProcess([
      ...exec,
      "psql",
      "-U",
      "postgres",
      "-d",
      "inagle_probe",
      "-X",
      "-A",
      "-t",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=sqlstate",
      "-c",
      sql,
    ]);
    if (result.exitCode) throw new Error("Local probe SQL failed; diagnostic hash " + result.diagnosticSha256);
    return result.stdout.trim();
  };
  const countsSql =
    "SELECT json_agg(json_build_object('schema',schema,'name',name,'rowCount',count) ORDER BY name) FROM (" +
    tables
      .map(
        t =>
          `SELECT 'public'::text AS schema, '${t.name}'::text AS name, COUNT(*) AS count FROM public.${quote(t.name)}`,
      )
      .join(" UNION ALL ") +
    ") c;";
  let started = false;
  try {
    const start = await boundedProcess(
      [
        "docker",
        "run",
        "-d",
        "--name",
        name,
        "--label",
        "io.aphrody.task=" + name,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--cpus",
        "1",
        "--memory",
        "2g",
        "--pids-limit",
        "256",
        "--user",
        "postgres",
        "--tmpfs",
        "/var/lib/postgresql:rw,nosuid,nodev,size=1536m,mode=1777",
        "--tmpfs",
        "/var/run/postgresql:rw,nosuid,nodev,size=16m,mode=1777",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=32m,mode=1777",
        "--mount",
        `type=bind,source=${archive},target=/input/rg.dump,readonly`,
        "--mount",
        `type=bind,source=${toc},target=/input/game.toc,readonly`,
        "-e",
        "POSTGRES_DB=inagle_probe",
        "-e",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "-e",
        "PGDATA=/var/lib/postgresql/18/probe",
        POSTGRES_IMAGE,
        "postgres",
        "-c",
        "listen_addresses=",
        "-c",
        "log_statement=none",
        "-c",
        "log_min_error_statement=panic",
        "-c",
        "log_error_verbosity=terse",
        "-c",
        "shared_buffers=64MB",
        "-c",
        "max_connections=10",
      ],
      30_000,
    );
    if (start.exitCode) throw new Error("Isolated PostgreSQL start failed: " + start.diagnosticSha256);
    started = true;
    const deadline = Date.now() + 60_000;
    for (;;) {
      const main = await boundedProcess(
        ["docker", "exec", name, "sh", "-c", 'test "$(cat /proc/1/comm)" = postgres'],
        5_000,
      );
      const ready =
        main.exitCode === 0
          ? await boundedProcess(
              [...exec, "psql", "-U", "postgres", "-d", "inagle_probe", "-X", "-q", "-c", "SELECT 1"],
              5_000,
            )
          : undefined;
      if (ready?.exitCode === 0) break;
      if (Date.now() > deadline) throw new Error("Isolated PostgreSQL readiness deadline exceeded");
      await Bun.sleep(100);
    }
    const restore = await boundedProcess([
      ...exec,
      "pg_restore",
      "-U",
      "postgres",
      "-d",
      "inagle_probe",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "--single-transaction",
      "--use-list",
      "/input/game.toc",
      "/input/rg.dump",
    ]);
    if (restore.exitCode) throw new Error("Game-only restore failed; diagnostic hash " + restore.diagnosticSha256);
    await query("BEGIN;" + policies + "COMMIT;");
    const ownerCounts = JSON.parse(await query(countsSql)) as TableMetadata[];
    const readerCounts = JSON.parse(await query("SET ROLE inagle_reader;" + countsSql)) as TableMetadata[];
    const expected = new Map(tables.map(t => [t.name, t.rowCount]));
    if (
      ownerCounts.some(t => expected.get(t.name) !== t.rowCount) ||
      JSON.stringify(ownerCounts) !== JSON.stringify(readerCounts)
    )
      throw new Error("Source/game/reader row-count parity failed");
    const db = JSON.parse(
      await query(
        "SELECT json_build_object('databaseBytes',pg_database_size(current_database()),'gameRelationsBytes',(SELECT sum(pg_total_relation_size(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),'tableCount',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),'rlsTables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity),'foreignTables',(SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema','public')),'installedExtensions',(SELECT json_agg(extname ORDER BY extname) FROM pg_extension),'readerWritePrivileges',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (has_table_privilege('inagle_reader',c.oid,'INSERT') OR has_table_privilege('inagle_reader',c.oid,'UPDATE') OR has_table_privilege('inagle_reader',c.oid,'DELETE'))));",
      ),
    );
    const writeTests = [];
    for (const table of [
      ...new Set(
        manifest.policyRewrites
          .filter((p: { target: string }) => p.target !== "reader")
          .map((p: { table: string }) => p.table),
      ),
    ] as string[]) {
      const name = table.slice("public.".length);
      const column = metadata.tables.find((t: TableMetadata) => t.schema === "public" && t.name === name)?.columns?.[0]
        ?.name;
      if (!column) throw new Error("Actual source column metadata required for policy qualification");
      const role =
        manifest.policyRewrites.find((p: { table: string }) => p.table === table).target === "importer"
          ? "inagle_importer"
          : "inagle_writer";
      const update = `UPDATE public.${quote(name)} SET ${quote(column)}=${quote(column)} WHERE ctid=(SELECT ctid FROM public.${quote(name)} LIMIT 1) RETURNING 1`;
      const reader = await boundedProcess([
        ...exec,
        "psql",
        "-U",
        "postgres",
        "-d",
        "inagle_probe",
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=sqlstate",
        "-c",
        "BEGIN; SET LOCAL ROLE inagle_reader; " + update + ";ROLLBACK;",
      ]);
      if (!reader.exitCode || !reader.sqlStates.includes("42501"))
        throw new Error("Reader write-denial policy gate failed");
      const affected = Number(
        await query(`BEGIN;SET LOCAL ROLE ${role};WITH touched AS (${update}) SELECT count(*) FROM touched;ROLLBACK;`),
      );
      const expectedRows = Math.min(1, expected.get(name) ?? 0);
      if (affected !== expectedRows) throw new Error("Scoped writer policy gate failed");
      writeTests.push({ table, role, readerSqlState: "42501", affectedRowsRolledBack: affected });
    }
    if (
      db.tableCount !== tables.length ||
      db.rlsTables !== tables.length - 1 ||
      db.foreignTables !== 0 ||
      db.readerWritePrivileges !== 0
    )
      throw new Error("Game schema/RLS/privilege boundary gate failed");
    const receipt = {
      schema: "iecode-game-probe/2",
      sourceSha256: plan.sourceSha256,
      allowlistSha256: plan.allowlistSha256,
      policySqlSha256: plan.policySqlSha256,
      image: POSTGRES_IMAGE,
      serverVersion: await query("SHOW server_version"),
      complete: true,
      tableCount: tables.length,
      rowCount: ownerCounts.reduce((n, t) => n + t.rowCount, 0),
      tables: ownerCounts,
      db,
      writeTests,
      readerCountsMatch: true,
      policyMembershipsGranted: false,
      network: "none",
      persistentVolumes: false,
      cloudWrites: false,
      sourceMutated: false,
      rawRowDataExported: false,
    };
    await writeFile(resolve(directory, "game-probe-ts.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ ...receipt, tables: undefined }));
  } finally {
    if (started) await cleanup();
  }
}

async function neonPreflight(directory: string, credentials: string) {
  if (process.platform !== "linux") throw new Error("Select the qualified native Docker host explicitly");
  const plan = JSON.parse(await readFile(resolve(directory, "neon-game-plan.json"), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(directory, "owner-partition-ts.json"), "utf8"));
  if (
    plan.schema !== "iecode-neon-game-plan/1" ||
    plan.status !== "read-only-preflight-approved" ||
    plan.projectName !== "inagle" ||
    typeof plan.projectId !== "string" ||
    !plan.projectId ||
    typeof plan.branchId !== "string" ||
    !plan.branchId ||
    typeof plan.endpointId !== "string" ||
    !plan.endpointId ||
    plan.database !== "inagle" ||
    plan.postgresMajor !== 18 ||
    plan.cloudWritesApproved !== false ||
    plan.sourceSha256 !== manifest.sourceSha256 ||
    plan.gameTocSha256 !== manifest.gameTocSha256 ||
    plan.policySqlSha256 !== manifest.policySqlSha256
  )
    throw new Error("Explicit isolated Inagle target required");
  for (const path of [credentials, resolve(credentials, "pgpass"), resolve(credentials, "pg_service.conf")])
    if ((await stat(path)).mode & 0o077) throw new Error("Credential store must remain private");
  const service = await readFile(resolve(credentials, "pg_service.conf"), "utf8");
  if (
    !service.includes("[inagle-import]") ||
    !/^sslmode\s*=\s*verify-full\s*$/m.test(service) ||
    !/^channel_binding\s*=\s*require\s*$/m.test(service) ||
    /^password\s*=/m.test(service)
  )
    throw new Error("Require a credential-free direct SSL service definition");
  const targetHost = /^host\s*=\s*(.+)\s*$/m.exec(service)?.[1]?.trim();
  if (targetHost !== plan.endpointHost || targetHost?.includes("-pooler."))
    throw new Error("Service endpoint does not match the pinned direct branch");
  const name = "iecode-neon-ro-" + randomUUID().replaceAll("-", "").slice(0, 12);
  const argv = [
    "docker",
    "run",
    "--rm",
    "--name",
    name,
    "--label",
    "io.aphrody.task=" + name,
    "--network",
    "bridge",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--cpus",
    "1",
    "--memory",
    "256m",
    "--pids-limit",
    "64",
    "--user",
    `${process.getuid?.()}:${process.getgid?.()}`,
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=16m,mode=1777",
    "--mount",
    `type=bind,source=${credentials},target=/run/iecode-neon,readonly`,
    "-e",
    "PGSERVICEFILE=/run/iecode-neon/pg_service.conf",
    "-e",
    "PGPASSFILE=/run/iecode-neon/pgpass",
    "-e",
    "PGSERVICE=inagle-import",
    "-e",
    "PGCONNECT_TIMEOUT=10",
    "-e",
    "LC_ALL=C",
    "-e",
    "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=30000",
    POSTGRES_IMAGE,
    "psql",
    "-X",
    "-A",
    "-t",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "SELECT json_build_object('database',current_database(),'role',current_user,'serverVersion',current_setting('server_version'),'readOnly',current_setting('transaction_read_only'),'backendSsl',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'userTables',(SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')),'roles',(SELECT json_agg(json_build_object('name',rolname,'canLogin',rolcanlogin,'canCreateRole',rolcreaterole,'bypassRls',rolbypassrls)) FROM pg_roles WHERE rolname IN (current_user,'inagle_reader','inagle_writer','inagle_importer')));",
  ];
  const result = await boundedProcess(argv, 60_000);
  if (result.exitCode) throw new Error("Read-only Neon preflight failed; diagnostic hash " + result.diagnosticSha256);
  const metadata = JSON.parse(result.stdout.trim());
  if (
    metadata.database !== "inagle" ||
    metadata.readOnly !== "on" ||
    metadata.userTables !== 0 ||
    !metadata.serverVersion.startsWith("18.")
  )
    throw new Error("Neon preflight empty target/read-only gate failed");
  const imageIndex = argv.indexOf(POSTGRES_IMAGE);
  const transportResult = await boundedProcess(
    [...argv.slice(0, imageIndex), POSTGRES_IMAGE, "psql", "-X", "--csv", "-c", "\\conninfo"],
    60_000,
  );
  if (transportResult.exitCode)
    throw new Error("Client TLS preflight failed; diagnostic hash " + transportResult.diagnosticSha256);
  const transport = {
    ...clientTransport(transportResult.stdout),
    sslmode: "verify-full",
    channelBinding: "require",
    evidence: "libpq client connection; backend pg_stat_ssl is recorded separately",
  };
  const receipt = {
    schema: "iecode-neon-preflight/2",
    projectId: plan.projectId,
    branchId: plan.branchId,
    endpointId: plan.endpointId,
    endpointHost: plan.endpointHost,
    image: POSTGRES_IMAGE,
    metadata,
    transport,
    credentialMount: "read-only",
    cloudWrites: false,
  };
  await writeFile(resolve(directory, "neon-preflight.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(receipt));
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const option = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const directory = option("--directory");
  const mode = option("--mode");
  if (!directory || !["prepare", "local-probe", "neon-preflight"].includes(mode ?? ""))
    throw new Error(
      "Use --directory <explicit protected folder> --mode prepare|local-probe|neon-preflight [--credentials <protected folder>]",
    );
  if (mode === "prepare") await prepare(resolve(directory));
  else if (mode === "local-probe") await localProbe(resolve(directory));
  else {
    const credentials = option("--credentials");
    if (!credentials) throw new Error("Explicit credential directory required");
    await neonPreflight(resolve(directory), resolve(credentials));
  }
}
