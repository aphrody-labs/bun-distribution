#!/usr/bin/env bash
set -euo pipefail
psql -X -d postgres -Atqc "select rolname || ':' || rolcreatedb || ':' || rolsuper from pg_roles where rolname in ('ubuntu','aphrody','aphrody_web') order by rolname"
pg_dump -d aphrody -s -t public.aphrody_bxc_rankings -t public.aphrody_seo_entities |
  grep -E '^CREATE TABLE|^CREATE (UNIQUE )?INDEX|^ALTER TABLE .*ADD CONSTRAINT'
