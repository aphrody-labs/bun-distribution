import { expect, test } from "bun:test";
import { clientTransport, partitionArchive } from "./database-partition.js";

const sourceSha256 = "a".repeat(64);
const header = (id: number, name: string, kind: string, schema: string, sql: string) =>
  `-- TOC entry ${id} (class 0 OID 0)\n-- Name: ${name}; Type: ${kind}; Schema: ${schema}; Owner: owner\n${sql}\n`;
const toc = [
  "1; 2615 1 SCHEMA - public owner",
  "2; 1259 2 TABLE public inagle_awakenings owner",
  "3; 1259 3 TABLE public profiles owner",
  "4; 1259 4 TABLE public niers_schema_migrations owner",
  "5; 0 2 TABLE DATA public inagle_awakenings owner",
  "6; 0 3 TABLE DATA public profiles owner",
  "7; 0 4 TABLE DATA public niers_schema_migrations owner",
  "8; 3256 8 POLICY public inagle_awakenings Admin Write Awakenings owner",
  "9; 3256 9 POLICY public inagle_awakenings anon_read owner",
  "10; 0 2 ACL public TABLE inagle_awakenings owner",
].join("\n");
const schemaSql = [
  header(1, "public", "SCHEMA", "-", "-- public schema support"),
  header(
    2,
    "inagle_awakenings",
    "TABLE",
    "public",
    "CREATE TABLE public.inagle_awakenings (id text);",
  ),
  header(3, "profiles", "TABLE", "public", "CREATE TABLE public.profiles (id text);"),
  header(
    4,
    "niers_schema_migrations",
    "TABLE",
    "public",
    "CREATE TABLE public.niers_schema_migrations (version text);",
  ),
  header(
    8,
    "inagle_awakenings Admin Write Awakenings",
    "POLICY",
    "public",
    'CREATE POLICY "Admin Write Awakenings" ON public.inagle_awakenings TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid()));',
  ),
  header(
    9,
    "inagle_awakenings anon_read",
    "POLICY",
    "public",
    "CREATE POLICY anon_read ON public.inagle_awakenings FOR SELECT TO anon USING (true);",
  ),
].join("\n");
const fixture = () => ({
  toc,
  schemaSql,
  sourceSha256,
  expectedEntries: 10,
  tables: [
    { schema: "public", name: "inagle_awakenings", rowCount: 20 },
    { schema: "public", name: "profiles", rowCount: 4 },
    { schema: "public", name: "niers_schema_migrations", rowCount: 4 },
  ],
  history: {
    sourceSha256,
    rows: 4,
    technicalFamilyMatches: { inagle: 4 },
    rawValuesExported: false as const,
  },
});

test("client TLS evidence qualifies an encrypted proxy connection independently of backend pg_stat_ssl", () => {
  const conninfo =
    "Parameter,Value\nSSL Connection,true\nSSL Library,OpenSSL\nSSL Protocol,TLSv1.3\nSSL Key Bits,256\nSSL Cipher,TLS_AES_256_GCM_SHA384\nSSL Compression,false\n";
  const evidence = clientTransport(conninfo);
  expect(evidence.protocol).toBe("TLSv1.3");
  expect(evidence.keyBits).toBe(256);
  expect(evidence.cipher).toBe("TLS_AES_256_GCM_SHA384");
  expect(evidence.conninfoSha256).toHaveLength(64);
  expect(clientTransport(conninfo.replace("TLSv1.3", "TLSv1.2")).protocol).toBe("TLSv1.2");
  expect(() =>
    clientTransport(conninfo.replace("SSL Connection,true", "SSL Connection,false")),
  ).toThrow("client TLS");
  expect(() => clientTransport(conninfo.replace("TLSv1.3", "TLSv1.1"))).toThrow("client TLS");
  expect(() => clientTransport(conninfo.replace("Bits,256", "Bits,64"))).toThrow("client TLS");
  expect(() => clientTransport(conninfo + "SSL Protocol,TLSv1.3\n")).toThrow("Invalid client SSL");
});

test("each source table data entry is assigned once to its owner, including Inagle migration history", () => {
  const result = partitionArchive(fixture());
  expect(result.entries).toHaveLength(10);
  expect(result.tables.filter((t) => t.owner === "game").map((t) => t.name)).toEqual([
    "inagle_awakenings",
    "niers_schema_migrations",
  ]);
  expect(result.gameToc).toContain("5; 0 2 TABLE DATA public inagle_awakenings owner");
  expect(result.gameToc).toContain("7; 0 4 TABLE DATA public niers_schema_migrations owner");
  expect(result.gameToc).not.toContain("TABLE DATA public profiles");
  expect(result.rgToc).toContain("6; 0 3 TABLE DATA public profiles owner");
  expect(result.rgToc).not.toContain("TABLE DATA public inagle_");
  expect(result.cloudWritesApproved).toBe(false);
});

test("cross-store admin policies become scoped NOLOGIN writer privileges, without RG identities or public write grants", () => {
  const result = partitionArchive(fixture());
  expect(result.gameToc).not.toContain("POLICY public inagle_awakenings Admin Write");
  expect(result.policySql).not.toContain("auth.uid");
  expect(result.policySql).not.toContain("public.profiles");
  expect(result.policySql).not.toContain("TO authenticated");
  expect(result.policySql).toContain(
    "CREATE ROLE inagle_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
  );
  expect(result.policySql).toContain(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON public.inagle_awakenings TO inagle_writer",
  );
  expect(result.policySql).toContain("FOR ALL TO inagle_writer USING (true) WITH CHECK (true)");
  expect(result.policyRewrites.map((p) => p.target)).toEqual(["writer", "reader"]);
  expect(result.policySql).toContain("FOR SELECT TO inagle_reader USING (true)");
  expect(result.gameToc).not.toContain(" ACL ");
  expect(result.entries.find((e) => e.id === 10)?.disposition).toBe("privileges-held");
  expect(result.crossStoreDependencies).toEqual([
    {
      id: 8,
      kind: "POLICY",
      owner: "game",
      disposition: "policy-rewrite",
      relations: ["public.profiles"],
      functions: ["auth.uid"],
      confidence: "INFERRED",
    },
  ]);
});

test("a migration-history owner guess cannot qualify an unrelated or incomplete archive", () => {
  const input = fixture();
  expect(() =>
    partitionArchive({
      ...input,
      history: { ...input.history, technicalFamilyMatches: { inagle: 3 } },
    }),
  ).toThrow("ownership evidence");
  expect(() =>
    partitionArchive({ ...input, history: { ...input.history, sourceSha256: "b".repeat(64) } }),
  ).toThrow("ownership evidence");
  expect(() => partitionArchive({ ...input, expectedEntries: 11 })).toThrow("coverage");
});

test("duplicate TOC IDs, unknown descriptions and uninventoried data fail before generating an allowlist", () => {
  const input = fixture();
  expect(() =>
    partitionArchive({ ...input, toc: input.toc + "\n" + input.toc.split("\n")[0] }),
  ).toThrow("Duplicate TOC");
  expect(() =>
    partitionArchive({ ...input, toc: input.toc + "\n11; 0 0 PRIVATE DATA public private owner" }),
  ).toThrow("Unknown TOC");
  expect(() =>
    partitionArchive({ ...input, toc: input.toc + "\n11; 0 0 TABLE DATA public missing owner" }),
  ).toThrow("Uninventoried table data");
  expect(() =>
    partitionArchive({
      ...input,
      toc: input.toc.replace(
        "7; 0 4 TABLE DATA public niers_schema_migrations owner",
        "11; 0 2 TABLE DATA public inagle_awakenings owner",
      ),
    }),
  ).toThrow("each table exactly once");
});

test("a game foreign key into RG accounts cannot enter the game allowlist as a restorable dependency", () => {
  const input = fixture();
  expect(() =>
    partitionArchive({
      ...input,
      expectedEntries: 11,
      toc: input.toc + "\n11; 2606 11 FK CONSTRAINT public inagle_awakenings profiles_fk owner",
      schemaSql:
        input.schemaSql +
        header(
          11,
          "inagle_awakenings profiles_fk",
          "FK CONSTRAINT",
          "public",
          "ALTER TABLE ONLY public.inagle_awakenings ADD CONSTRAINT profiles_fk FOREIGN KEY (id) REFERENCES public.profiles(id);",
        ),
    }),
  ).toThrow("Unresolved game cross-store dependency");
});
