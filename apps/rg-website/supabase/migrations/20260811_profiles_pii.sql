-- Ferme la lecture publique des données personnelles de `public.profiles`.
--
-- CONSTAT (11/8/2026) : la policy héritée de Supabase est
-- `Public profiles are viewable by everyone` → `SELECT ... USING (true)`, et le
-- rôle `anon` disposait d'un GRANT SELECT au niveau **table**. Comme la clé
-- `anon` est publique par conception (embarquée dans le bundle navigateur),
-- n'importe qui pouvait lire les **e-mails et adresses postales** des 31
-- comptes :
--
--   curl 'https://…/rest/v1/profiles?select=email' -H "apikey: <clé anon>"
--
-- Un GRANT au niveau table couvre toutes les colonnes et masque tout REVOKE
-- par colonne : il faut donc révoquer la table AVANT de re-granter la liste
-- blanche, sinon la révocation est silencieusement sans effet.
--
-- Conséquence assumée : `select=*` sur `profiles` échoue désormais pour `anon`
-- (« permission denied for table profiles »). Les comptages `head=true`
-- continuent de fonctionner. Le seul appel applicatif qui lisait `*` est
-- l'export RGPD, qui passe au client service-role — ce qu'il aurait dû faire
-- dès le départ.
--
-- Application : psql -d rg -f apps/website/sql/migrations/20260811_profiles_pii.sql

REVOKE SELECT ON public.profiles FROM anon, authenticated;

-- Liste blanche : ce qu'un profil public expose légitimement.
GRANT SELECT (
    id,
    updated_at,
    username,
    avatar_url,
    role,
    website,
    discord_id,
    bio,
    banner_url,
    twitter_handle,
    badges
) ON public.profiles TO anon, authenticated;

-- Restent réservées au service_role : email, full_name, address_line1,
-- address_line2, city, postal_code, country, patreon_id.
