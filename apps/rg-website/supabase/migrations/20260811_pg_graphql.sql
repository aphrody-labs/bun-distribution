-- API GraphQL auto-générée, calquée sur l'exposition Supabase.
--
-- Prérequis système (paquet officiel, PG 18) :
--   curl -sL -o /tmp/pg_graphql.deb \
--     https://github.com/supabase/pg_graphql/releases/download/v1.6.1/pg_graphql-v1.6.1-pg18-amd64-linux-gnu.deb
--   sudo dpkg -i /tmp/pg_graphql.deb
--
-- Côté PostgREST : `db-schemas = "public, graphql_public"`.
-- Côté nginx : `location = /graphql/v1` → `/rpc/graphql` avec le profil
-- `graphql_public` (infra/nginx/supabase-compat.inc).
--
-- Application : psql -d rg -f apps/website/sql/migrations/20260811_pg_graphql.sql

CREATE SCHEMA IF NOT EXISTS graphql;
CREATE EXTENSION IF NOT EXISTS pg_graphql SCHEMA graphql;

-- Schéma d'exposition : c'est lui que PostgREST publie, pas `graphql` directement.
CREATE SCHEMA IF NOT EXISTS graphql_public;

CREATE OR REPLACE FUNCTION graphql_public.graphql(
    "operationName" text DEFAULT NULL,
    query text DEFAULT NULL,
    variables jsonb DEFAULT NULL,
    extensions jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE sql AS $$
    SELECT graphql.resolve(
        query := query,
        variables := coalesce(variables, '{}'),
        "operationName" := "operationName",
        extensions := extensions
    );
$$;

ALTER SCHEMA graphql OWNER TO rg;
ALTER SCHEMA graphql_public OWNER TO rg;
GRANT USAGE ON SCHEMA graphql, graphql_public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA graphql, graphql_public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA graphql TO anon, authenticated, service_role;

-- ⚠ Drapeau de fonctionnalité : depuis pg_graphql 1.6.0 l'introspection est
-- DÉSACTIVÉE par défaut. Sans ce commentaire, toute requête `__schema` ou
-- `__type` répond « Unknown field "__schema" on type Query » — les requêtes de
-- données fonctionnent quand même, ce qui rend le symptôme trompeur. GraphiQL
-- (onglet GraphQL de Studio) en a besoin pour peupler son explorateur.
-- Le niveau d'exposition reste cohérent avec la spec OpenAPI de PostgREST
-- (`openapi-mode = ignore-privileges`) : la forme du schéma est publique, les
-- données restent protégées par les policies RLS.
COMMENT ON SCHEMA public IS '@graphql({"introspection": true})';
