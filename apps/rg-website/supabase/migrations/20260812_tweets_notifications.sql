-- Notification Discord des nouveaux tweets : curseur persistant, réglage, index.
--
-- Trois objets, un seul but : que `rg-bot.service` puisse annoncer les nouveaux
-- posts de `public.tweets` sans jamais doublonner ni rejouer l'archive.
--
-- ── POURQUOI PAS UN DÉCLENCHEUR TEMPS RÉEL ────────────────────────────────
-- Le motif maison (`20260811_realtime_notify.sql`) est `AFTER INSERT OR UPDATE
-- OR DELETE … FOR EACH ROW`. Appliqué à `tweets`, mesuré le 12/8/2026 :
--
--   lot 05:01 → 629 notifications, 0 tweet réellement neuf
--   lot 05:10 → 340 notifications, 70 neufs
--   lot 22:21 → 278 notifications, 245 neufs
--
-- La récolte réécrit les `metrics` des tweets déjà connus : 629 notifications
-- pour un simple rafraîchissement de compteurs. S'y ajoute `raw_tweets jsonb`,
-- qui pousse la charge au-delà de 7 ko et déclenche la branche `truncated`
-- (le client doit relire de toute façon), et le flux SSE n'étant pas
-- authentifié, on arroserait tous les navigateurs du site pour rien.
-- La détection se fait donc par CURSEUR, côté bot.

-- 1. Index de lecture du curseur.
--    `tweets` ne portait que sa clé primaire sur `id text` : chaque drain
--    faisait un Seq Scan (12 998 lignes rejetées, 2204 buffers, 4,6 ms). La
--    table tient en cache, mais un balayage complet toutes les minutes pour
--    zéro résultat neuf n'a aucune raison d'exister.
CREATE INDEX IF NOT EXISTS tweets_created_at_desc_idx ON public.tweets (created_at DESC);

-- 2. Curseur de publication — la SEULE source de vérité de « qu'a-t-on déjà
--    annoncé ». Il est persistant et appartient à celui qui publie (le bot) :
--    deux démons avec deux curseurs distincts posteraient deux fois.
--    Précédent maison : `x_campagne_curseurs`.
CREATE TABLE IF NOT EXISTS public.tweet_notification_curseurs (
	-- Destination logique (un salon Discord = un canal). Permet d'ajouter plus
	-- tard un second flux sans toucher au premier.
	canal            text PRIMARY KEY,
	-- Horodatage du dernier tweet ANNONCÉ. Tout ce qui est strictement postérieur
	-- est candidat ; rien d'antérieur ne sera jamais rejoué.
	curseur_le       timestamptz NOT NULL,
	dernier_tweet_id text,
	-- Compteur cumulé d'annonces publiées, pour `/tweets suivi`.
	annonces         integer NOT NULL DEFAULT 0,
	maj_le           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tweet_notification_curseurs IS
	'Curseur de publication Discord des tweets. Créé à now() au premier démarrage : un curseur absent ne déclenche JAMAIS de rattrapage de l''archive.';

-- État interne d'un démon : aucune raison d'être lisible par un visiteur.
-- RLS active SANS aucune policy = personne d'autre que le propriétaire.
ALTER TABLE public.tweet_notification_curseurs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tweet_notification_curseurs FROM anon, authenticated;

-- 3. Réglage pilotable sans redéploiement.
--    `settings` porte déjà le déclencheur `rg_realtime_settings` : un `UPDATE`
--    se propage en direct. Précédent : les 7 clés `patreon.*`.
--
--    `actif: false` au départ — DÉLIBÉRÉ. La fonctionnalité s'allume par un
--    UPDATE conscient, pas par le simple fait d'avoir appliqué une migration.
--
--    La liste blanche vient de l'activité réelle sur 30 jours, pas du volume
--    total : les gros comptes de l'archive sont morts (`mutugame` 0 post depuis
--    le 17/6/2026, `inazumaSD_L5` depuis 2020). Ces huit-là pèsent ~122 posts
--    sur 30 jours, soit ~4 par jour.
--    `leak` est en plus exclu EN DUR côté code : un `UPDATE` ne peut pas le
--    réactiver.
INSERT INTO public.settings (key, value, description)
VALUES (
	'tweets.notification',
	'{
		"actif": false,
		"comptes": ["inazuma_project", "inazuma_cross", "InazumaSeries", "InazumaNational", "Level5Hub", "LEVEL5_times", "Azalee_IE", "rose_griffon"],
		"categories_exclues": ["fan-content"],
		"max_par_lot": 5,
		"salon": null
	}'::jsonb,
	'Notification Discord des nouveaux tweets : interrupteur, liste blanche de comptes X, catégories exclues, taille max d''un lot détaillé, salon de destination (null = DISCORD_NEWS_CHANNEL_ID).'
)
ON CONFLICT (key) DO NOTHING;
