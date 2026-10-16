-- `inagle_rag_edges` redevient ce qu'elle a toujours dû être : lisible par tous,
-- écrite par personne d'autre que le pipeline.
--
-- ── CE QUI ÉTAIT OUVERT ────────────────────────────────────────────────────
-- L'audit de production du 14/8/2026 a relevé, sur les 41 491 lignes de cette
-- table :
--
--   anon          : SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   authenticated : SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   relrowsecurity = false
--
-- `anon` n'est pas un rôle interne : sa clé JWT est publiée dans le bundle
-- navigateur d'azalée, donc lisible par n'importe quel visiteur. Un TRUNCATE
-- envoyé à PostgREST avec cette clé publique effaçait le graphe entier — c'est
-- la seule table du schéma `public` qui cumulait droit d'écriture anonyme et
-- absence de RLS. Les six autres objets remontés par la même requête
-- (`content_feed`, `inagle_*_clean`) sont des VUES non auto-updatables
-- (`pg_relation_is_updatable` = 0) : rien ne s'écrit à travers elles.
--
-- ── CE QUE ÇA NE CASSE PAS ─────────────────────────────────────────────────
-- Le graphe est alimenté par `service_role`, qui conserve tous ses droits et
-- contourne la RLS par construction. La lecture publique reste entière : le
-- contenu est un graphe lua→assets du jeu (`{"src":"lua:...","dst":"asset:..."}`),
-- sans aucune donnée personnelle — d'où une policy SELECT permissive plutôt
-- qu'une restriction de lecture.
--
-- REVOKE ne suffirait pas seul : sans RLS activée, un GRANT réintroduit par une
-- future migration rouvrirait le trou en silence. Les deux vont ensemble.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260814_rag_edges_lecture_seule.sql

begin;

revoke insert, update, delete, truncate, references, trigger
    on public.inagle_rag_edges
    from anon, authenticated;

alter table public.inagle_rag_edges enable row level security;

drop policy if exists "lecture publique" on public.inagle_rag_edges;
create policy "lecture publique"
    on public.inagle_rag_edges
    for select
    to anon, authenticated
    using (true);

commit;
