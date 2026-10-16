-- La double authentification, enfin branchée sur une table qui existe.
--
-- ── LE PLACEHOLDER QUE CETTE TABLE FERME ──────────────────────────────────
-- La page de compte affichait une carte « Double authentification » avec un
-- bouton grisé « Bientôt disponible », alors que le plugin `twoFactor` était
-- déjà déclaré CÔTÉ SERVEUR (`apps/website/src/lib/auth.ts`) ET CÔTÉ CLIENT
-- (`auth-client.ts`, avec une redirection vers `/2fa`). Trois pièces sur
-- quatre : il manquait la table, l'interface — et `/2fa` répondait 404, ce qui
-- veut dire qu'un compte qui aurait réussi à activer la 2FA se serait retrouvé
-- devant une page introuvable à sa connexion suivante, sans aucun moyen de
-- saisir son code. Le placeholder n'était donc pas seulement une promesse
-- vide : c'était un piège armé.
--
-- ── POURQUOI UNE TABLE ET PAS LES COLONNES DE `user` ──────────────────────
-- `user` porte encore `two_factor_secret` et `two_factor_backup_codes`,
-- héritées d'une version antérieure du plugin. Better Auth 1.6 ne les utilise
-- plus : son schéma déclare une table `twoFactor` dédiée (secret, codes de
-- secours, compteur d'échecs, verrou temporaire) et ne garde sur `user` que le
-- drapeau `two_factor_enabled`. Écrire dans les anciennes colonnes ne
-- produirait rien du tout — vérifié dans
-- `node_modules/better-auth/dist/plugins/two-factor/schema.d.mts`.
-- Les deux colonnes sont laissées en place (elles sont vides : aucun compte
-- n'avait la 2FA active) plutôt que supprimées : une colonne en trop ne coûte
-- rien, une colonne supprimée par erreur ne se récupère pas.
--
-- ── LE VERROU EST DANS LA TABLE, PAS DANS LE CODE ─────────────────────────
-- `failed_verification_count` et `locked_until` sont ce qui empêche de forcer
-- un code à six chiffres par répétition. Ils appartiennent à la ligne, pas à
-- une mémoire de processus : le site tourne en bleu/vert, deux instances
-- servent en alternance, et un compteur gardé en mémoire se remettrait à zéro
-- à chaque bascule — c'est-à-dire exactement quand on en aurait besoin.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260831_two_factor.sql

begin;

create table if not exists public.two_factor (
	id                        text primary key,
	user_id                   text not null references public."user"(id) on delete cascade,
	-- Secret TOTP et codes de secours : Better Auth les chiffre lui-même avec
	-- `BETTER_AUTH_SECRET` avant de les écrire. Ils ne sont JAMAIS renvoyés à
	-- un client (`returned: false` dans le schéma du plugin).
	secret                    text not null,
	backup_codes              text not null,
	-- `verified` distingue une 2FA armée d'une 2FA seulement demandée : tant que
	-- le premier code n'a pas été validé, le compte ne doit pas être verrouillé
	-- derrière un secret que personne n'a encore scanné.
	verified                  boolean not null default true,
	failed_verification_count integer not null default 0,
	locked_until              timestamptz
);

-- Un compte n'a qu'une inscription 2FA, et on la retrouve par l'utilisateur à
-- chaque connexion : l'index unique sert autant l'intégrité que la lecture.
create unique index if not exists two_factor_user_id_key on public.two_factor (user_id);

-- ── ACCÈS ─────────────────────────────────────────────────────────────────
-- Cette table ne se lit JAMAIS depuis le navigateur. Elle porte le secret qui
-- fait toute la valeur du second facteur : un `select` en rôle `anon` le
-- rendrait inutile. Aucun GRANT n'est donc posé (seul le propriétaire `rg`,
-- donc le serveur Better Auth, y accède), et RLS est activé pour que même un
-- GRANT ajouté par erreur plus tard ne suffise pas.
alter table public.two_factor enable row level security;
revoke all on public.two_factor from anon, authenticated;

commit;
