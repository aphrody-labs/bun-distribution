/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LA requête des créations d'une campagne — une seule, pour trois appelants.
 *
 * ── POURQUOI CE MODULE EXISTE ─────────────────────────────────────────────
 * Cette requête décide qui a droit à un ticket de tirage. Elle a vécu en DEUX
 * copies (`tirage-queries.ts` et `scripts/campagnes/exporter-participants.ts`),
 * chacune annonçant l'autre en commentaire, et elles avaient DÉJÀ divergé : la
 * copie du script s'était enrichie d'une colonne `permalien` que l'autre
 * ignorait. Une troisième copie devenait nécessaire pour le script d'empreintes.
 * Une clause de visibilité oubliée dans une seule copie, et le règlement masqué
 * par le staff entre dans le roster en prenant une chance à quelqu'un : ce genre
 * de requête ne se recopie pas.
 *
 * Ce fichier est PUR — aucun import, aucune dépendance à Next ni à `pg`. C'est
 * ce qui le rend lisible à la fois par le bundle serveur du site et par un
 * script Bun lancé à la main.
 *
 * ── L'ORDRE DES CLAUSES DU `case` EST L'ORDRE DE PRIORITÉ DES MOTIFS ──────
 * Du plus général au plus particulier : une campagne dépubliée rend tout le
 * reste sans objet, un message masqué n'a pas besoin qu'on discute de sa
 * fenêtre. `cross join camp` : campagne introuvable → zéro ligne, donc roster
 * vide. C'est le repli honnête (« on ne sait rien de cette campagne »), pas une
 * erreur.
 *
 * ── CE QUE LES CLAUSES RECOPIENT, ET POURQUOI ─────────────────────────────
 * Le rôle `rg` est PROPRIÉTAIRE des tables : la RLS ne le filtre pas. Chaque
 * clause de visibilité des policies publiques est donc recopiée à la main dans
 * le `case` — `publiee`, `not masque`, `a_media`, `deleted_at is null`, `suivi`,
 * la fenêtre `debut_le`/`fin_le`, et les comptes organisateurs.
 *
 * Paramètre unique : `$1` = le slug de la campagne.
 */
export const SQL_CREATIONS = `
	with camp as (
		select slug, debut_le, fin_le, comptes_organisateurs, publiee
		  from public.x_campagnes
		 where slug = $1
	), brutes as (
		select 'x'::text as source,
		       p.tweet_id as identifiant,
		       nullif('x:' || coalesce(btrim(t.author_id), ''), 'x:') as cle_identite,
		       t.author_name as auteur_nom,
		       t.author_username as auteur_pseudo,
		       coalesce(p.publie_le, p.collecte_le) as horodatage,
		       greatest(p.nb_images, 1)::int as nb_images,
		       p.masque as masque,
		       p.a_media as a_media,
		       false as supprime,
		       false as salon_non_suivi,
		       t.author_username as pseudo_public,
		       'https://x.com/' || coalesce(t.author_username, 'i') || '/status/' || p.tweet_id as permalien
		  from public.x_campagne_posts p
		  join public.tweets t on t.id = p.tweet_id
		 where p.campagne_slug = $1

		union all

		select 'discord', d.message_id,
		       nullif('discord:' || coalesce(btrim(m.author_id), ''), 'discord:'),
		       m.author_display_name, m.author_username,
		       coalesce(d.publie_le, d.collecte_le),
		       greatest(d.nb_images, 1)::int,
		       d.masque, d.a_media,
		       (m.deleted_at is not null),
		       (not coalesce(s.suivi, false)),
		       m.author_username,
		       'https://discord.com/channels/' || coalesce(m.guild_id, '@me') || '/' || m.channel_id || '/' || m.message_id
		  from public.campagne_creations_discord d
		  join public.discord_messages m on m.message_id = d.message_id
		  left join public.discord_channels s on s.channel_id = m.channel_id
		 where d.campagne_slug = $1

		union all

		select 'instagram', i.shortcode,
		       nullif('instagram:' || lower(coalesce(btrim(i.auteur_pseudo), '')), 'instagram:'),
		       i.auteur_pseudo, i.auteur_pseudo,
		       coalesce(i.publie_le, i.collecte_le),
		       greatest(i.nb_images, 1)::int,
		       i.masque, i.a_media,
		       false, false,
		       i.auteur_pseudo,
		       i.permalink
		  from public.campagne_creations_instagram i
		 where i.campagne_slug = $1
	)
	select b.source, b.identifiant, b.cle_identite, b.auteur_nom, b.auteur_pseudo,
	       b.horodatage, b.nb_images, b.permalien,
	       case
	         when not c.publiee
	           then 'campagne dépubliée : ses créations ne sont visibles de personne'
	         when b.masque
	           then 'masquée par la modération'
	         when not b.a_media
	           then 'aucune image : la règle 1 en exige une'
	         when b.supprime
	           then 'message supprimé sur Discord'
	         when b.salon_non_suivi
	           then 'salon retiré de la veille : la création n''est plus archivée'
	         when b.cle_identite is null
	           then 'auteur sans identifiant exploitable : impossible de lui attribuer un ticket'
	         when b.horodatage is null
	           then 'sans date de publication : impossible de la situer dans la fenêtre'
	         when c.debut_le is not null and b.horodatage < c.debut_le
	           then 'publiée avant l''ouverture de la campagne'
	         when c.fin_le is not null and b.horodatage > c.fin_le
	           then 'publiée après la clôture de la campagne'
	         when b.pseudo_public is not null and exists (
	                select 1 from unnest(c.comptes_organisateurs) o
	                 where lower(o) = lower(b.pseudo_public))
	           then 'compte organisateur de la campagne'
	       end as motif_ecart
	  from brutes b
	  cross join camp c
	 order by b.horodatage nulls last, b.source, b.identifiant`;
