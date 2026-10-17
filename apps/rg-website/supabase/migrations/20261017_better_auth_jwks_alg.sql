-- Better Auth 1.7 records the signing algorithm and curve of each JWKS key.
-- Its startup schema check rejects every request while these columns are
-- missing; existing keys keep NULL and are read with the plugin default.
alter table if exists public.jwks
  add column if not exists alg text,
  add column if not exists crv text;
