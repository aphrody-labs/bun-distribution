-- SPDX-License-Identifier: Apache-2.0
-- windex schema v1: filesystem nodes, PE metadata, imports/exports, services and drivers, typed graph edges.
-- Immutable once applied: later changes go to a new numbered migration.

CREATE SCHEMA IF NOT EXISTS windex;

-- One id space for every graph node (directories, files, services, symbols).
CREATE SEQUENCE IF NOT EXISTS windex.node_id_seq;

CREATE TABLE windex.volume (
  letter      text PRIMARY KEY,
  serial      text,
  journal_id  numeric(20),
  next_usn    bigint,
  mft_records bigint,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE windex.root (
  path_lc     text COLLATE "C" PRIMARY KEY,
  path        text NOT NULL,
  hash_mode   text NOT NULL CHECK (hash_mode IN ('all', 'pe', 'none')),
  graph       boolean NOT NULL DEFAULT true,
  scanned_at  timestamptz,
  entries     bigint,
  files       bigint,
  pe_files    bigint,
  errors      bigint,
  duration_ms bigint
);

CREATE TABLE windex.fs_node (
  id          bigint PRIMARY KEY DEFAULT nextval('windex.node_id_seq'),
  path        text NOT NULL,
  path_lc     text COLLATE "C" NOT NULL UNIQUE,
  parent_lc   text COLLATE "C",
  parent_id   bigint REFERENCES windex.fs_node (id) ON DELETE CASCADE,
  name        text NOT NULL,
  ext         text NOT NULL DEFAULT '',
  is_dir      boolean NOT NULL,
  frn         numeric(20),
  size        bigint NOT NULL DEFAULT 0,
  attrs       integer NOT NULL DEFAULT 0,
  nlink       integer NOT NULL DEFAULT 1,
  created_at  timestamptz,
  modified_at timestamptz,
  accessed_at timestamptz,
  changed_at  timestamptz,
  sha256      text CHECK (sha256 IS NULL OR length(sha256) = 64),
  ads         jsonb,
  error       text,
  usn         bigint,
  seen_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fs_node_parent_id ON windex.fs_node (parent_id);
CREATE INDEX fs_node_parent_lc ON windex.fs_node (parent_lc);
CREATE INDEX fs_node_frn ON windex.fs_node (frn);
CREATE INDEX fs_node_name_lc ON windex.fs_node (lower(name));
CREATE INDEX fs_node_sha256 ON windex.fs_node (sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX fs_node_ext ON windex.fs_node (ext);

CREATE TABLE windex.pe (
  node_id           bigint PRIMARY KEY REFERENCES windex.fs_node (id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('exe', 'dll', 'sys', 'efi', 'mui')),
  machine           text NOT NULL,
  bits              smallint NOT NULL,
  subsystem         text NOT NULL,
  characteristics   integer NOT NULL,
  dll_characteristics integer NOT NULL,
  linker_ts         bigint,
  image_base        numeric(20),
  image_size        bigint,
  entry_rva         bigint,
  is_dotnet         boolean NOT NULL DEFAULT false,
  file_version      text,
  product_version   text,
  company           text,
  description       text,
  product           text,
  original_filename text,
  internal_name     text,
  copyright         text,
  signature         text NOT NULL CHECK (signature IN ('embedded', 'catalog', 'none')),
  signer            text,
  signer_issuer     text,
  digest            text,
  catalog           text,
  export_name       text,
  n_imports         integer NOT NULL DEFAULT 0,
  n_exports         integer NOT NULL DEFAULT 0,
  warnings          text[]
);
CREATE INDEX pe_kind ON windex.pe (kind);
CREATE INDEX pe_signature ON windex.pe (signature);

CREATE TABLE windex.pe_import (
  node_id   bigint NOT NULL REFERENCES windex.fs_node (id) ON DELETE CASCADE,
  module    text NOT NULL,
  delay     boolean NOT NULL DEFAULT false,
  functions text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (node_id, module, delay)
);
CREATE INDEX pe_import_module ON windex.pe_import (module);

CREATE TABLE windex.pe_export (
  node_id   bigint NOT NULL REFERENCES windex.fs_node (id) ON DELETE CASCADE,
  ordinal   integer NOT NULL,
  name      text,
  forwarder text,
  PRIMARY KEY (node_id, ordinal)
);
CREATE INDEX pe_export_name ON windex.pe_export (name);

-- ApiSet contracts (api-ms-win-*/ext-ms-win-* without the trailing revision) -> host modules.
CREATE TABLE windex.apiset (
  contract text PRIMARY KEY,
  hosts    text[] NOT NULL
);

CREATE TABLE windex.service (
  id                bigint PRIMARY KEY DEFAULT nextval('windex.node_id_seq'),
  name              text NOT NULL UNIQUE,
  display_name      text,
  description       text,
  type              integer,
  kind              text,
  start             integer,
  start_mode        text,
  error_control     integer,
  grp               text,
  image_path        text,
  image_lc          text COLLATE "C",
  service_dll       text,
  service_dll_lc    text COLLATE "C",
  object_name       text,
  depend_on_service text[] NOT NULL DEFAULT '{}',
  depend_on_group   text[] NOT NULL DEFAULT '{}',
  seen_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE windex.symbol (
  id   bigint PRIMARY KEY DEFAULT nextval('windex.node_id_seq'),
  name text NOT NULL UNIQUE
);

-- Materialised typed edges; `contains` comes from fs_node.parent_id through the graph_edge view.
CREATE TABLE windex.edge (
  src   bigint NOT NULL,
  dst   bigint NOT NULL,
  kind  text NOT NULL CHECK (kind IN ('imports', 'exports', 'depends_on', 'service', 'driver')),
  label text NOT NULL DEFAULT '',
  PRIMARY KEY (src, kind, dst, label)
);
CREATE INDEX edge_dst ON windex.edge (dst, kind);

-- Import resolution: module as imported -> host module (ApiSet contracts resolved, others unchanged).
CREATE FUNCTION windex.module_host(module text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT a.hosts[1] FROM windex.apiset a
      WHERE module ~ '^(api|ext)-'
        AND a.contract = regexp_replace(regexp_replace(module, '\.dll$', ''), '-[^-]*$', '')),
    module)
$$;

-- Directory searched for an importer: same directory first, then System32 (SysWOW64 for 32-bit), then drivers.
CREATE FUNCTION windex.resolve_import(importer_parent text, bits smallint, host text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT f.id FROM windex.fs_node f
  WHERE f.path_lc IN (
    importer_parent || '\' || host,
    CASE WHEN bits = 32 THEN 'c:\windows\syswow64\' ELSE 'c:\windows\system32\' END || host,
    'c:\windows\system32\drivers\' || host
  ) AND NOT f.is_dir
  ORDER BY f.path_lc = importer_parent || '\' || host DESC,
           position('\drivers\' IN f.path_lc) > 0 ASC
  LIMIT 1
$$;

-- Recomputes the imports/exports edges of the given PE nodes.
CREATE FUNCTION windex.refresh_pe_edges(ids bigint[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM windex.edge WHERE src = ANY (ids) AND kind IN ('imports', 'exports');
  INSERT INTO windex.edge (src, dst, kind, label)
  SELECT DISTINCT i.node_id, t.id, 'imports', i.module
  FROM windex.pe_import i
  JOIN windex.fs_node n ON n.id = i.node_id
  JOIN windex.pe p ON p.node_id = i.node_id
  CROSS JOIN LATERAL (SELECT windex.resolve_import(n.parent_lc, p.bits, windex.module_host(i.module)) AS id) t
  WHERE i.node_id = ANY (ids) AND t.id IS NOT NULL
  ON CONFLICT DO NOTHING;
  INSERT INTO windex.symbol (name)
  SELECT DISTINCT e.name FROM windex.pe_export e WHERE e.node_id = ANY (ids) AND e.name IS NOT NULL
  ON CONFLICT (name) DO NOTHING;
  INSERT INTO windex.edge (src, dst, kind, label)
  SELECT e.node_id, s.id, 'exports', COALESCE(e.forwarder, '')
  FROM windex.pe_export e JOIN windex.symbol s ON s.name = e.name
  WHERE e.node_id = ANY (ids)
  ON CONFLICT DO NOTHING;
END
$$;

-- Re-resolves the importers of modules whose files appeared (a DLL created after its importers).
CREATE FUNCTION windex.refresh_importers(names text[]) RETURNS void
LANGUAGE sql AS $$
  SELECT windex.refresh_pe_edges(array_agg(DISTINCT i.node_id))
  FROM windex.pe_import i
  WHERE windex.module_host(i.module) = ANY (names)
$$;

-- Recomputes service, driver and dependency edges from the service table.
CREATE FUNCTION windex.refresh_service_edges() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM windex.edge WHERE kind IN ('service', 'driver', 'depends_on');
  INSERT INTO windex.edge (src, dst, kind, label)
  SELECT s.id, f.id, CASE WHEN s.type & 3 <> 0 THEN 'driver' ELSE 'service' END, 'image'
  FROM windex.service s JOIN windex.fs_node f ON f.path_lc = s.image_lc
  ON CONFLICT DO NOTHING;
  INSERT INTO windex.edge (src, dst, kind, label)
  SELECT s.id, f.id, 'service', 'servicedll'
  FROM windex.service s JOIN windex.fs_node f ON f.path_lc = s.service_dll_lc
  ON CONFLICT DO NOTHING;
  INSERT INTO windex.edge (src, dst, kind, label)
  SELECT s.id, d.id, 'depends_on', 'service'
  FROM windex.service s CROSS JOIN LATERAL unnest(s.depend_on_service) dep(name)
  JOIN windex.service d ON lower(d.name) = lower(dep.name)
  ON CONFLICT DO NOTHING;
  INSERT INTO windex.edge (src, dst, kind, label)
  SELECT s.id, d.id, 'depends_on', 'group:' || g.name
  FROM windex.service s CROSS JOIN LATERAL unnest(s.depend_on_group) g(name)
  JOIN windex.service d ON lower(d.grp) = lower(g.name)
  ON CONFLICT DO NOTHING;
END
$$;

CREATE VIEW windex.graph_node AS
  SELECT f.id, CASE WHEN f.is_dir THEN 'dir' WHEN p.node_id IS NOT NULL THEN 'pe' ELSE 'file' END AS kind,
         f.path AS label, p.kind AS pe_kind
  FROM windex.fs_node f LEFT JOIN windex.pe p ON p.node_id = f.id
  UNION ALL
  SELECT s.id, CASE WHEN s.type & 3 <> 0 THEN 'driver' ELSE 'service' END, s.name, NULL FROM windex.service s
  UNION ALL
  SELECT y.id, 'symbol', y.name, NULL FROM windex.symbol y;

CREATE VIEW windex.graph_edge AS
  SELECT parent_id AS src, id AS dst, 'contains'::text AS kind, ''::text AS label
  FROM windex.fs_node WHERE parent_id IS NOT NULL
  UNION ALL
  SELECT src, dst, kind, label FROM windex.edge;

CREATE VIEW windex.pe_file AS
  SELECT f.id, f.path, f.name, f.size, f.sha256, f.modified_at, p.*
  FROM windex.fs_node f JOIN windex.pe p ON p.node_id = f.id;
