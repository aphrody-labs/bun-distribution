-- Réglages de communauté de la guilde Rose Griffon — les valeurs, pas le schéma.
--
-- Le SCHÉMA vit dans `apps/bot/src/lib/reglages-communaute.ts` (zod). Les
-- VALEURS vivent ici, en base, et c'est délibéré : le staff doit pouvoir
-- déplacer un salon de tickets ou ajouter un rôle de modération sans qu'on
-- redéploie un service. Aucun de ces identifiants n'est écrit dans le code du
-- bot.
--
-- ── D'OÙ VIENNENT CES IDENTIFIANTS ─────────────────────────────────────────
-- Tous relevés le 14/8/2026 sur l'API Discord (`GET /guilds/…/channels` et
-- `GET /guilds/…/roles`), pas déduits :
--
--   catégorie « 𝐒𝐮𝐩𝐩𝐨𝐫𝐭 »      1097193189212966973  (type 4)
--   📩〡demandes-tickets        1097189982826938529
--   📦〡ticket-history          1097198504667005099  (84 cartes, tickets 1 → 85)
--   🤖〡bots                    1135698156835852369
--   Modérateurs                1086314307383459880  (position 87)
--   Staffs                     1072992327766904865  (position 86)
--   Administrateur             1072993826400124958  (position 93, Administrator)
--   Vice-administratreur       1371547071362105374  (position 92, Administrator)
--   Resp. Modération           1267847004919300096  (position 88, Administrator)
--
-- ── POURQUOI CETTE RÉPARTITION STAFF / DIRECTION ───────────────────────────
-- `rolesStaff` prend en charge les tickets ordinaires. `rolesDirection` voit EN
-- PLUS les tickets sensibles (catégorie « Signalement »). La distinction n'est
-- pas hiérarchique par principe : un signalement peut viser un modérateur, et
-- l'ouvrir à toute la modération préviendrait la personne visée avant même que
-- le staff n'ait lu la demande. Les trois rôles de direction retenus sont
-- exactement ceux qui portent la permission `Administrator`, hors comptes de
-- service (« Robot de Garde », « Noctaly », « Médaille Réglage »,
-- « Double des Clés » — des rôles à permission haute qui ne sont pas des rôles
-- de modération humaine).
--
-- ── POURQUOI 🤖〡bots EST EXCLU DE L'XP ─────────────────────────────────────
-- C'est le salon des commandes. Y compter l'XP ferait de l'appel répété d'une
-- commande la façon la plus rentable de monter, ce qui est exactement le
-- contraire de ce que le système mesure. Il reste le salon d'ANNONCE : on y
-- lit les montées de niveau, on n'y en gagne pas.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260814_bot_communaute_reglages.sql

begin;

insert into public.bot_reglages_guilde (guild_id, valeurs, maj_le)
values (
	'1072991720268111892',
	jsonb_build_object(
		'niveaux', jsonb_build_object(
			'actif',          true,
			-- ⚠ `aucune`, et c'est une RÈGLE, pas un défaut prudent : aucune
			-- publication publique automatique ne s'active par une migration. Un
			-- administrateur ou un modérateur doit l'allumer lui-même, en connaissance
			-- de cause, avec `/gestion niveaux annonce` — c'est lui qui choisit le
			-- salon et le palier, et c'est lui qui répond du bruit produit.
			--
			-- Ce fichier ne fait que PRÉPARER le terrain : le salon `🤖〡bots` est
			-- exclu du gain d'XP (c'est le salon des commandes, l'y compter ferait de
			-- l'appel répété d'une commande la façon la plus rentable de monter), et
			-- les valeurs de filtrage sont posées pour que l'activation n'ait rien à
			-- régler d'autre.
			'annonce',        'aucune',
			'salonAnnonce',   null,
			-- Un niveau sur cinq, plus les trois changements de rang d'une vie de
			-- membre. Sans ce filtre, un membre actif déclenche une annonce tous les
			-- deux ou trois jours en début de courbe (le niveau 10 coûte 2 422 XP).
			'palierAnnonce',  5,
			'annoncerRang',   true,
			'salonsExclus',   jsonb_build_array('1135698156835852369'),
			'rolesExclus',    jsonb_build_array()
		),
		-- Idem : l'accueil des nouveaux ne publie rien tant qu'un humain n'a pas
		-- dit où (`/gestion accueil lieu`). Le rôle d'arrivée reste vide.
		'accueil', jsonb_build_object(
			'actif',       true,
			'lieu',        'aucune',
			'salon',       null,
			'texte',       null,
			'roleArrivee', null,
			'carte',       true
		),
		'tickets', jsonb_build_object(
			'actif',            true,
			'mode',             'fil',
			'salonPanneau',     '1097189982826938529',
			'salonHistorique',  '1097198504667005099',
			'categorieSupport', '1097193189212966973',
			'rolesStaff',       jsonb_build_array('1086314307383459880', '1072992327766904865'),
			'rolesDirection',   jsonb_build_array(
				'1072993826400124958', '1371547071362105374', '1267847004919300096'
			)
		),
		-- Même règle : pas de salon d'annonce posé d'avance.
		'kizuna', jsonb_build_object(
			'actif',        true,
			'salonAnnonce', null
		)
	),
	now()
)
on conflict (guild_id) do update
	set valeurs = excluded.valeurs,
	    maj_le  = now();

commit;
