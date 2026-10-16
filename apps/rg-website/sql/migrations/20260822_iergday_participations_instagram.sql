-- Les deux participations INSTAGRAM d'IERG Day entrent dans la galerie.
--
-- Application :
--   export PGPASSWORD=$(grep -oP 'postgresql://rg:\K[^@]+' ../rg/.env | head -1)
--   psql -h 127.0.0.1 -U rg -d rg -f apps/website/sql/migrations/20260822_iergday_participations_instagram.sql
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE MIGRATION, ET PAS UN DÉPÔT PAR LE FORMULAIRE
-- ─────────────────────────────────────────────────────────────────────────────
-- `campagne_creations_instagram` était VIDE pour `iergday` (compté ce jour :
-- 0 ligne) alors que deux créations avaient bien été publiées sur Instagram avec
-- `#iergday`. Elles étaient donc absentes de la galerie ET, ce qui est pire,
-- absentes du tirage : une participante aurait été écartée d'un tirage auquel
-- elle avait droit, sans que rien ne le signale.
--
-- Le formulaire de dépôt (`deposerCreationInstagram`) exige une SESSION du
-- participant et un fichier téléversé à la main. L'autrice n'est pas passée par
-- là, et la campagne se ferme ce soir à 21:59:59 UTC : c'est l'équipe qui
-- saisit, d'où `origine = 'staff'` et `soumis_par` laissé NULL — personne du
-- côté du site n'a « déposé » ces lignes, et inventer un déposant serait faux.
--
-- Tout le reste recopie TRAIT POUR TRAIT la convention du formulaire : bucket
-- `assets`, chemin déterministe `campagnes/<slug>/instagram/<shortcode>.<ext>`,
-- et la même forme de l'entrée jsonb `images` (7 clés : chemin, nom, taille,
-- type_mime, largeur, hauteur, url_origine). C'est cette forme-là que lit
-- `imagesDiscord()` dans `lib/x-campagnes/queries.ts`, partagée par les deux
-- sources ré-hébergées ; une huitième clé ou un `chemin` absent et la carte
-- disparaît de la galerie en silence.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUI EST MESURÉ (Meta l'a dit) — le 22/8/2026
-- ─────────────────────────────────────────────────────────────────────────────
-- `https://www.instagram.com/api/v1/oembed/?url=<permalien>&omitscript=true`
-- répond 200 SANS jeton et rend 16 champs, dont ceux repris ici :
--   * `title`         -> la légende, telle que l'autrice l'a écrite ;
--   * `author_name`   -> `orphelinalius` (Nora Lius Foster) pour les DEUX posts ;
--   * `media_id`      -> `<pk>_<user_id>` ;
--   * `thumbnail_url` -> la vignette, 640 x 853, signée.
-- Le 200 vaut aussi vérification d'existence : c'est exactement la question à
-- laquelle répond `verifierPublication()`, d'où `verifie_le = now()`.
--
-- ⚠ NE PAS CONFONDRE AVEC L'AUTRE oEMBED. Le code de `verifierPublication()`
-- interroge `graph.facebook.com/v23.0/instagram_oembed`, qui répond 200 lui
-- aussi mais ne rend plus que 6 champs (version, provider_name, provider_url,
-- type, width, html) : il sert à savoir SI un post existe, jamais à en lire le
-- contenu. Les deux ont été comparés côte à côte avant d'écrire ces lignes.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUI EST DÉDUIT (Meta ne l'a PAS dit) : `publie_le`
-- ─────────────────────────────────────────────────────────────────────────────
-- L'oEmbed ne rend AUCUNE date. Les horodatages ci-dessous sont CALCULÉS depuis
-- le `media_id`, dont les 41 bits de poids fort comptent les millisecondes
-- depuis le 24/8/2011 21:07:01.721 UTC :
--       ms_epoch = (pk >> 23) + 1314220021721
-- Deux contrôles indépendants ont été passés avant de s'en servir :
--   1. le shortcode décodé en base64url (`A-Za-z0-9-_`) rend EXACTEMENT le même
--      `pk` que le `media_id` — les deux identifiants concordent ;
--   2. la balise `og:description` du HTML public de chaque post écrit la date en
--      clair : « on August 21, 2026 » et « on August 22, 2026 ». Elle confirme
--      le JOUR des deux valeurs ci-dessous.
-- L'HEURE, elle, ne vient d'aucune source officielle. Que personne ne prenne
-- plus tard ces horodatages pour une donnée rendue par Meta : ils sont exacts à
-- la milliseconde SI la formule l'est, et c'est tout ce qu'on peut en dire.
--
-- Ce que la déduction tranche, et c'est pour ça qu'elle vaut la peine : la
-- seconde participation tombe à 21:16:18 UTC, soit 43 MINUTES avant la clôture
-- (`fin_le = 2026-08-22 21:59:59+00`). Les deux sont dans la fenêtre.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- L'IMAGE EST UNE VIGNETTE 640 px, ET IL N'Y A PAS MIEUX PUBLIQUEMENT
-- ─────────────────────────────────────────────────────────────────────────────
-- `thumbnail_url` rend 640 x 853, pas l'original. Les pistes ont été essayées :
--   * remplacer `p640x640` par `p1080x1080` / `p2048x2048` dans l'URL -> 403 ;
--   * retirer le paramètre `stp` -> 403.
--     (la signature `oh=` couvre `stp` : toute retouche invalide l'URL entière)
--   * `og:image` du HTML public -> 640 x 640 RECADRÉE (`c288.0.864.864a`),
--     donc STRICTEMENT PIRE que la vignette de l'oEmbed, qui n'est pas rognée.
-- On assume donc la vignette. Le jour où l'API Graph sera accordée, ou si
-- l'autrice envoie ses fichiers, le même `on conflict` remplacera l'image sans
-- créer de doublon — c'est à ça que sert la clé `(campagne_slug, shortcode)`.
--
-- ⚠ RÉ-HÉBERGEMENT OBLIGATOIRE, pas un confort. Les URL `cdninstagram.com` sont
-- signées ET datées (`oe=6A9016E6` = expiration) : servir le lien d'origine
-- donnerait une galerie de vignettes mortes en quelques jours. Les fichiers sont
-- déjà écrits sur le disque du Storage, ce script ne fait qu'en poser l'index.
--
-- REJOUABLE. Les deux `on conflict` sont écrits pour qu'une seconde exécution ne
-- change RIEN — ni les colonnes de modération, ni la trace de vérification.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Index des fichiers dans le Storage
-- ─────────────────────────────────────────────────────────────────────────────
-- Les fichiers ont été copiés à la main dans `/var/www/rg-storage/assets/…`
-- (mêmes propriétaire et droits que le dossier `discord/` voisin : ubuntu:ubuntu,
-- 644). Le service `rg-storage` sert `/object/public/…` DEPUIS LE DISQUE, donc
-- l'image s'afficherait même sans ces deux lignes — mais `storage.objects` est
-- l'inventaire, et c'est lui que lisent le listing, l'explorateur de Studio et
-- les scripts de reprise. Un fichier hors inventaire est un fichier que personne
-- ne retrouvera le jour d'une purge.
--
-- Forme reprise à `indexObject()` (`apps/storage/server.ts`) : `cacheControl` y
-- est CODÉ EN DUR à `max-age=3600`, quoi qu'envoie l'appelant — c'est donc bien
-- cette valeur-là qu'il faut écrire, et pas le « 3600 » que passe la server
-- action.
--
-- ⚠ `version` est ABSENT du `do update` : il date le CONTENU du fichier, et le
-- bousculer à chaque rejeu ferait croire à une nouvelle copie là où rien n'a
-- bougé.
--
-- ⚠ ET `updated_at` NE SUFFIT PAS À L'OMETTRE. Le trigger hérité de Supabase
-- `update_objects_updated_at` (BEFORE UPDATE, FOR EACH ROW) le repose à `now()`
-- quoi qu'on écrive dans le `set`. Mesuré en rejouant ce fichier : le premier
-- jet laissait `updated_at` glisser de 14 secondes alors qu'aucun octet du
-- fichier n'avait changé. D'où le `where … is distinct from …` : sans lui,
-- l'UPDATE part quand même, le trigger se déclenche, et la migration cesse
-- d'être un vrai no-op. Avec, un rejeu affiche `INSERT 0 0` — zéro ligne
-- touchée, donc zéro trigger.
insert into storage.objects (bucket_id, name, metadata, created_at, updated_at, last_accessed_at, version)
values
	('assets', 'campagnes/iergday/instagram/DcUEDDKoTgP.jpg',
	 jsonb_build_object('size', 57504, 'mimetype', 'image/jpeg', 'cacheControl', 'max-age=3600'),
	 now(), now(), now(), gen_random_uuid()::text),
	('assets', 'campagnes/iergday/instagram/DcW22ScIdYv.jpg',
	 jsonb_build_object('size', 98554, 'mimetype', 'image/jpeg', 'cacheControl', 'max-age=3600'),
	 now(), now(), now(), gen_random_uuid()::text)
on conflict (bucket_id, name) do update
	set metadata = excluded.metadata
	where storage.objects.metadata is distinct from excluded.metadata;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Les deux créations
-- ─────────────────────────────────────────────────────────────────────────────
-- `hashtag_trouve` vaut `iergday` : la valeur n'est pas recopiée à la main, elle
-- a été obtenue en passant les deux légendes RÉELLES dans
-- `hashtagDansLegende()` (`@rosegriffon/types/instagram`) avec les hashtags de
-- la campagne — la même fonction que le formulaire. C'est bien le hashtag
-- PUBLIC (`x_campagnes.hashtags`) et non la variante de rattrapage
-- `inazumargday`, donc la galerie l'affichera en `#IERGDay`.
--
-- `a_media` = true / `nb_images` = 1 disent « une image ré-hébergée, donc
-- servable » — la sémantique stricte des trois sources. Ici c'est vrai : les
-- fichiers sont sur notre disque, indexés juste au-dessus.
--
-- ⚠ `jsonb_build_object` et non un paramètre lié : le piège du double encodage
-- (`${JSON.stringify(x)}::jsonb` avec Bun.SQL) ne concerne PAS le SQL brut, mais
-- écrire le tableau à la main garde la colonne lisible en revue.
insert into public.campagne_creations_instagram
	(campagne_slug, shortcode, permalink, auteur_pseudo, legende, hashtag_trouve,
	 a_media, nb_images, images, publie_le, origine, verifie_le, masque)
values
	(
		'iergday',
		'DcUEDDKoTgP',
		'https://www.instagram.com/p/DcUEDDKoTgP/',
		'orphelinalius',
		E'Voilà participation pour #iergday  Nathan apprend la danse d\'eole a Cierra. Malheureusement je suis pas sur de pouvoir l\'encrer donc il va rester comme ça. Et je sais pas si j\'aurai le temps de faire le deuxième que j\'avais prévu mais bon. J\'avoue que maintenant les défi RG sont la seule choses qui me fasse dessiner du Inazuma... C\'est triste mais bon\n\n#inazumaeleven #inazumaelevengo #inazumaelevenoc #hissatsutechnique',
		'iergday',
		true,
		1,
		jsonb_build_array(jsonb_build_object(
			'chemin',      'campagnes/iergday/instagram/DcUEDDKoTgP.jpg',
			'nom',         'DcUEDDKoTgP.jpg',
			'taille',      57504,
			'type_mime',   'image/jpeg',
			'largeur',     640,
			'hauteur',     853,
			-- Le formulaire met le PERMALIEN dans `url_origine`, pas l'URL du CDN :
			-- une URL signée périmée ne trace rien. On garde ce choix.
			'url_origine', 'https://www.instagram.com/p/DcUEDDKoTgP/'
		)),
		-- DÉDUIT de media_id 3968814973364287503 (cf. en-tête). Jour confirmé par
		-- og:description (« on August 21, 2026 »), heure non confirmée.
		'2026-08-21 19:13:55.054+00'::timestamptz,
		'staff',
		now(),
		false
	),
	(
		'iergday',
		'DcW22ScIdYv',
		'https://www.instagram.com/p/DcW22ScIdYv/',
		'orphelinalius',
		E'2eme participation pour le #iergday  avec mon oc Victory Road\n\n#inazumaelevenvictoryroad  #inazumaelevenoc #nathanswift #footballdrawing',
		'iergday',
		true,
		1,
		jsonb_build_array(jsonb_build_object(
			'chemin',      'campagnes/iergday/instagram/DcW22ScIdYv.jpg',
			'nom',         'DcW22ScIdYv.jpg',
			'taille',      98554,
			'type_mime',   'image/jpeg',
			'largeur',     640,
			'hauteur',     853,
			'url_origine', 'https://www.instagram.com/p/DcW22ScIdYv/'
		)),
		-- DÉDUIT de media_id 3969601346736346671 (cf. en-tête). Jour confirmé par
		-- og:description (« on August 22, 2026 »), heure non confirmée. 43 minutes
		-- avant la clôture de la campagne.
		'2026-08-22 21:16:18.065+00'::timestamptz,
		'staff',
		now(),
		false
	)
on conflict (campagne_slug, shortcode) do update set
	permalink      = excluded.permalink,
	auteur_pseudo  = coalesce(excluded.auteur_pseudo, public.campagne_creations_instagram.auteur_pseudo),
	legende        = excluded.legende,
	hashtag_trouve = excluded.hashtag_trouve,
	a_media        = true,
	nb_images      = excluded.nb_images,
	images         = excluded.images,
	-- La migration fait AUTORITÉ sur la date : c'est justement ce qu'elle vient
	-- réparer. Le formulaire, lui, écrit `now()` au dépôt — si l'autrice
	-- redéposait ses créations, sa ligne porterait la date du dépôt et non celle
	-- de la publication, et rejouer ce fichier la remettrait d'aplomb.
	publie_le      = excluded.publie_le;
	-- ⚠ CE QUI N'EST PAS TOUCHÉ, ET POURQUOI :
	--  * `masque`, `motif_masquage`, `mis_en_avant` — même règle que les trois
	--    autres écritures : un rejeu ne doit PAS ressusciter une création qu'un
	--    modérateur vient de retirer, ni effacer une mise en avant.
	--  * `origine` — si l'autrice finit par déposer elle-même via le formulaire,
	--    sa ligne passera à `formulaire` : la repasser à `staff` effacerait un
	--    fait vrai.
	--  * `collecte_le` — date l'entrée en base, pas la dernière exécution du
	--    fichier.
	--  * `verifie_le` — rejouer ce fichier ne rappelle PAS Meta. Y écrire `now()`
	--    affirmerait une vérification qui n'a pas eu lieu, et ferait passer ces
	--    deux lignes en queue de l'ordre du cron (`verifie_le nulls first`), donc
	--    retarderait la vraie revalidation. C'est la tâche
	--    `campagnes:instagram` qui possède cette colonne après le premier passage.

commit;
