-- Sondages Discord : rattachement du visuel et langue de l'encart.
--
-- POURQUOI CE COMPLEMENT
-- 1. LE VISUEL. Dix des quarante-neuf sondages posent une question qui renvoie à
--    « l'image ci-dessus » : sans elle, la question est illisible. Cette image
--    n'appartient PAS à l'encart du bot — elle est dans le message humain voisin.
--    Le lien entre les deux n'existe nulle part : c'est une déduction (auteur
--    humain, même salon, ±15 minutes), et une déduction se stocke.
-- 2. POURQUOI UN CHEMIN DE STOCKAGE, ET SURTOUT PAS UNE URL DISCORD.
--    Les URL de pièces jointes Discord sont SIGNÉES ET EXPIRANTES. Mesuré le
--    12/8/2026 : l'URL signée répond 200, la même privée de sa query répond 404,
--    et son paramètre `ex` la fait expirer le 13/8/2026 à 04:54 UTC. Republier
--    une telle URL, c'est publier une page qui casse en moins de 24 heures.
--    L'import recopie donc l'image dans le bucket public `assets` sous un chemin
--    déterministe, et c'est CE chemin qu'on garde. Le site le préfixe avec
--    NEXT_PUBLIC_SUPABASE_URL (https://rosegriffon.fr) — origine déjà autorisée
--    dans images.remotePatterns.
-- 3. LA LANGUE. EasyPoll a écrit ses encarts en anglais jusqu'en 2026 (48 sur 49)
--    puis en français. Le parseur sait forcément laquelle il a reconnue ; la
--    perdre obligerait à re-parser pour poser un `lang="en"` sur une question
--    anglaise au milieu d'une page française — ce que les lecteurs d'écran et les
--    moteurs de recherche exploitent réellement.
--
-- Ces colonnes traversent le trigger `rg_realtime_notify()` déjà posé sur la
-- table, donc le flux SSE NON AUTHENTIFIÉ : aucune ne contient de donnée
-- personnelle (un chemin de fichier, des dimensions, un code de langue).
-- `discord_poll_votes` reste sans aucune policy de lecture : rien ici ne la touche.
--
-- Idempotent : rejouable sans effet.
-- Application : psql "$DATABASE_URL" -f apps/website/supabase/migrations/20260812_sondages_complement.sql

begin;

alter table public.discord_polls
	-- Message HUMAIN d'où provient le visuel. On garde le lien vers la source,
	-- pas seulement la copie : c'est ce qui permet de rejouer le rattachement.
	add column if not exists visual_message_id    text
		references public.discord_messages (message_id) on delete set null,
	-- Identifiant de la pièce jointe d'origine, ou 'embed-<n>' quand le visuel
	-- venait de la vignette d'un encart (cas d'un lien Tenor : 1 sondage sur 49).
	add column if not exists visual_attachment_id text,
	-- Chemin DANS le bucket public `assets`, sans le nom du bucket.
	-- Ex. 'discord/sondages/3e501896/1409….png'.
	add column if not exists visual_path          text,
	add column if not exists visual_width         integer,
	add column if not exists visual_height        integer,
	-- Texte alternatif saisi par l'autrice de la pièce jointe (champ
	-- `description` de Discord) : la seule alternative honnête à un alt inventé.
	add column if not exists visual_alt           text,
	-- 'fr' | 'en' : lexique de sections reconnu par le parseur ('Choix' vs
	-- 'Choices'). NULL pour un sondage natif Discord, qui n'a pas d'encart.
	add column if not exists language             text;

comment on column public.discord_polls.visual_path is
	'Chemin dans le bucket public `assets`. JAMAIS une URL cdn.discordapp.com : celles-ci sont signées et expirent en moins de 24 h.';
comment on column public.discord_polls.visual_message_id is
	'Message humain voisin (±15 min) dont provient le visuel — rattachement déduit, pas déclaré par Discord.';
comment on column public.discord_polls.language is
	'Langue de l''encart analysé : ''fr'' ou ''en''. NULL pour un sondage natif Discord.';

commit;
