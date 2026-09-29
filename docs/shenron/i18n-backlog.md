# i18n — textes d'interface encore écrits en dur (hors /admin)

Mesuré par `bun apps/site/scripts/i18n-audit.ts`. Total : 907 chaînes dans 251 fichiers.

| Fichier | Chaînes | Exemples |
|---|---:|---|
| `app\admin\dashboard\page.tsx` | 23 | Certains indicateurs ne répondent pas. Les valeurs manquantes ne sont pas interprétées comme des zéros. · Actualisé automatiquement · Est-ce que tout fonctionne ? |
| `app\admin\canon\CanonEditor.tsx` | 23 | Promesse affichée sous la barre · Le verdict vient d'une table curée à la main… · Broly est-il canonique ? |
| `components\admin\UnifiedIaCockpit.tsx` | 22 | Banc Doré (Gold-Set) · Résultats pour : · Aucune règle canon spécifique activée. |
| `app\admin\levels\page.tsx` | 18 | Activé · Désactivé · Enregistré ✓ |
| `components\editor\ui\dialogs.tsx` | 16 | Texte affiché · Voir la fiche de Goku · Une page du site (/wiki/…) ou une adresse complète. |
| `app\admin\posts\ArticleEditor.tsx` | 16 | Modifications non enregistrées · Légende · Résumé & thèmes |
| `app\admin\a2a\A2AViewer.tsx` | 16 | Canal fichier & RPC unifié · ⚡ Console d'Ordres A2A (Dispatch Déterministe) · ocr (état mesuré ou ordre en attente d'un worker) |
| `components\admin\DatabooksCatalogManager.tsx` | 14 | Planches Déjà Traduites · Protocole de Sécurité · Toutes les catégories |
| `app\admin\api-docs\page.tsx` | 14 | Ne jamais inventer une donnée éditoriale. · Les écritures sont signées. · Fil d&apos;actualité |
| `components\admin\TranscriptionRelecteur.tsx` | 13 | Aucune planche pour ce filtre. · Aucune planche à afficher. · Aucun texte à prévisualiser. |
| `app\confidentialite\page.tsx` | 13 | ne demande aucun compte · préférences · qu'après votre accord explicite |
| `app\admin\campagnes-bxc\page.tsx` | 13 | BXC · zone de réception · Campagnes & médias en revue · Campagnes détectées |
| `app\admin\shop\page.tsx` | 12 | Gestion de la Boutique Shenron · Bannières · Tous les types |
| `app\admin\canvas\page.tsx` | 12 | CANVAS & THÈMES · Récupération des canvases disponibles. · Racism-o-mètre (rouge) |
| `app\admin\activite\page.tsx` | 12 | Aucune vue de fiche. · Aucune recherche. · Aucun événement. |
| `components\admin\WikiSectionsPanel.tsx` | 11 | Chargement des sections échoué. · Aucune section pour l&apos;instant. · Ajout échoué. Réessaie. |
| `app\admin\triggers\page.tsx` | 11 | Déclencheurs de succès · Désactivé · Aucune description |
| `app\admin\economy\page.tsx` | 11 | Économie · — Désactivé (aucune notification) — · Aucun membre enregistré. |
| `app\admin\commands\page.tsx` | 11 | Chargement des commandes… · aucune règle définie · Règle par défaut |
| `components\wiki\NarrativeEventsExplorer.tsx` | 10 | Total Événements · Combats Légendaires · Événements Filtrés |
| `app\admin\home\HomeEditor.tsx` | 10 | Aucun clip disponible. · Catalogue média · Rails alimentés par les données réelles du wiki. |
| `app\admin\chronologie\ChronologyEditor.tsx` | 10 | Voir la frise publique · Épisodes · Rechercher un titre / une série… |
| `components\tierlist\TierlistEditor.tsx` | 9 | Description de la tierlist (optionnelle) · Renvoyer la carte sélectionnée dans la réserve · Nom de la nouvelle carte |
| `app\shop\ShopGrid.tsx` | 9 | Solde indisponible pour le moment. · Indice des prix · Prix stables : l&apos;inflation n&apos;est pas active. |
| `components\admin\DatabookPagesPanel.tsx` | 8 | numéro · Premier numéro de la séquence · Remet les numéros en séquence à partir du départ choisi |
| `app\wiki\evenements\page.tsx` | 8 | Films DBZ Hors-Série · Chronologie des Sagas · Index des Arcs Narratifs |
| `app\admin\ursaf\page.tsx` | 8 | Indice des prix · Rattrapage des signalements · Simulation des avis |
| `app\admin\cron\page.tsx` | 8 | Chargement des tâches… · Tâches automatiques · Nombre d'exécutions |
| `components\wiki\GamesExplorer.tsx` | 7 | Date de sortie (récents) · Meilleures notes des fans · Ordre alphabétique (A-Z) |
| `components\wiki\WikiContribute.tsx` | 7 | Proposition envoyée. · Se connecter avec Discord · Le texte tel qu'il devrait être |
| `components\databooks\DatabookReader.tsx` | 7 | Chargement de la transcription… · Aucune description pour cette page. · Défilement |
| `components\admin\DatabookAdminList.tsx` | 7 | Rechercher dans les databooks · Filtrer par catégorie · Toutes catégories |
| `app\admin\sync\page.tsx` | 7 | • Arrivée d'un membre → création du profil en DB · • Changement de rôle → recalcul du niveau et du rôle de rang · zénis |
| `app\admin\moderation\page.tsx` | 7 | Modération · Aucun motif précisé · Peine indéfinie |
| `app\admin\db-universe\assets\page.tsx` | 7 | Toutes licences · Aucun média · Aucun fichier ne correspond à ces filtres. |
| `components\profile\ProfileCardCustomizer.tsx` | 6 | Possédé · Équipé · ∅ Aucun titre honorifique |
| `components\manga\MangaReader.tsx` | 6 | Mode de lecture paginé · Mode paginé · Affichage double-page (grand écran) |
| `app\wiki\page.tsx` | 6 | Vœux & Règles · Écouter & Analyser · Encyclopédie |
| `app\wiki\staff\page.tsx` | 6 | Éditeur Découvreur · Consulter la Biographie Complète &amp; Anthologie Toriyama · Annuaire des Voix &amp; Seiyū |
| `app\stats\page.tsx` | 6 | Communauté Discord · Le site en chiffres · Le bot Discord et l'audience du site, en direct et anonymisés. |
| `app\classements\page.tsx` | 6 | Panthéon des Guerriers · Top 3 des œuvres · Panthéon des Guerriers · Top 3 Puissance |
| `app\admin\settings\page.tsx` | 6 | Chargement de la configuration… · surchargé · true (activé) |
| `app\admin\profile\page.tsx` | 6 | Sélectionnez un membre · Arrivée sur le serveur · Rôles Discord |
| `app\admin\giveaways\page.tsx` | 6 | Récupération des tirages au sort. · AUCUN TIRAGE · Récompense : |
| `app\admin\concours\page.tsx` | 6 | Concours communauté · Aucune note enregistrée. · Avis rédigés |
| `app\admin\audit-internal\page.tsx` | 6 | Journal des actions internes · — Toutes les actions — · Modérateur |
| `components\wiki\InterviewsExplorer.tsx` | 5 | Preuves RAG reliées au corpus canon · Ces résultats servent à retrouver les documents ; la citation éditoriale reste celle de l’ouvrage primaire. · Époque : |
| `components\wiki\VoiceActorsGrid.tsx` | 5 | Espace Unifié « Staff &amp; Casting International » · Voir le Staff &amp; Casting complet · Total Comédiens |
| `components\databooks\DatabookGrid.tsx` | 5 | Sections des publications imprimées · Filtrer par catégorie · Filtrer par état du contenu |
| `components\admin\ContributionRightsPanel.tsx` | 5 | Aucun rôle. · Aucun membre. · Retirer ce rôle |
| `components\admin\TranscriptionsDashboard.tsx` | 5 | Manga VF Intégral · Accéder → · Français Officiel (Shenron) |
| `components\admin\WikiAiAssistant.tsx` | 5 | passages sourcés · Recherche échouée. · Section créée ✓ |
| `app\wiki\jeux\page.tsx` | 5 | Statut Canonique & Univers Étendu (Gaming) · , les timelines altérées de · ou le Mode Histoire de |
| `app\wiki\contributeurs\[slug]\page.tsx` | 5 | Catégorie Métier · Date de Décès · Source des Données |
| `app\news\fil\[[...path]]\page.tsx` | 5 | Le fil · Les parutions de la rédaction et les discussions de la communauté, dans l'ordre où elles arrivent. · Flux RSS des articles |
| `app\licence\page.tsx` | 5 | ne vend ni produits dérivés ni abonnement · politique de confidentialité · en aucune façon affilié, sponsorisé, ou approuvé |
| `app\admin\discord\page.tsx` | 5 | Données indisponibles · Aucun salon accessible. · Rôles |
| `app\admin\design\DesignEditor.tsx` | 5 | Une palette qui tient le combat · Surfaces, accent principal, texte secondaire et énergie sont montrés ensemble. · « KA-ME-HA-ME-HA ! Stack UI Toriyama 100% opérationnelle ! » |
| `app\admin\database\[table]\page.tsx` | 5 | Impossible de récupérer les données. · Aucune entrée · Cette section est vide pour l&apos;instant. |
| `app\admin\agents\AgentKeysManager.tsx` | 5 | Nouvelle clé · Clés existantes · Créée&nbsp;: |
| `components\contest\ContestBoards.tsx` | 4 | Notes déposées sur les fiches épisodes, films, jeux et arcs. Départage aux avis rédigés. · Économie DBFR · Top fortunes en Zénis |
| `components\admin\AdminSidebar.tsx` | 4 | Déplier le menu · Replier le menu · Rechercher dans l’administration |
| `components\admin\RelationsPanel.tsx` | 4 | Chargement des relations échoué. · Aucune relation. · Action échouée. Réessaie. |
| `app\wiki\toriyama\page.tsx` | 4 | Archives InLife, Caramel Mama et Wikipédia JA : provenance affichée, statut non canonique. · Voir le dossier des sources → · Parcours éditorial |
| `app\wiki\search\page.tsx` | 4 | Consigne : grondé sur les archives du temple · Résultats attribués de toutes les classifications : canon et source sont deux informations distinctes. · ★ Auteur Démiurge |
| `app\wiki\episodes\[id]\EpisodeMediaEditor.tsx` | 4 | Aucune piste. « + Ajouter » pour en créer une. · Libellé (Français) · Code langue du fichier à importer |
| `app\wiki\combats\page.tsx` | 4 | Voir la vue Chronologique Complète · Chargement des événements narratifs... · Encyclopédie & Archives Narratives |
| `app\wiki\combats\[slug]\page.tsx` | 4 | Série · à · Épisodes Animés |
| `app\news\_journal.tsx` | 4 | Aucun article publié · La rédaction n'a encore rien mis en ligne. Le wiki, lui, est là : le manga, les épisodes et les films se parcourent dès maintenant. · Les dernières discussions |
| `app\jeux\bingo\BingoGame.tsx` | 4 | Aucun signal · lance un scan · défaut : 100 z win / 50 z loss · Puissance estimée, de 1 à 100 |
| `app\admin\tickets\TicketAccessPanel.tsx` | 4 | Aucun rôle configuré · Rejoue la configuration sur les tickets déjà ouverts · Retirer ce rôle |
| `app\admin\send\SendDiscordForm.tsx` | 4 | Chargement des salons… · Message envoyé avec succès. · Écrivez votre message ici… |
| `app\admin\hierarchy\page.tsx` | 4 | Hiérarchie du staff · plus bas · Aucun niveau défini. |
| `app\admin\audit\page.tsx` | 4 | Impossible de charger le journal. · Aucun motif · Modérateur |
| `components\wiki\CharacterGrid.tsx` | 3 | Chargement des versions… · Les versions n&apos;ont pas pu être chargées. · Trier les personnages |
| `components\wiki\DragonRadarSearch.tsx` | 3 | Lire → · Poser une question, chercher un épisode, chapitre ou combattant... · Effacer la recherche |
| `components\wiki\PowerLevelsTable.tsx` | 3 | Multiplicateur ×2 à ×20 · Période / Saga · Rechercher un personnage, une forme, un chiffre (ex: Goku, 150 000 000, Raditz)... |
| `components\wiki\UnifiedStaffExplorer.tsx` | 3 | Rechercher dans le staff ou casting · Rechercher par nom, personnage, œuvre (ex: Nozawa, Goku, Broly)... · Filtrer par ère |
| `components\wiki\WikiDrawer.tsx` | 3 | Explorer le Wiki · Encyclopédie Dragon Ball · Fermer le panneau |
| `components\wiki\WikiEditor.tsx` | 3 | — Sélectionner — · L&apos;aperçu s&apos;affiche ici… · Racontez la page… tapez « / » pour insérer un bloc. |
| `components\social\CommentThread.tsx` | 3 | Chargement de la discussion… · · modifié · Pagination des commentaires |
| `components\ratings\CommunityTops.tsx` | 3 | Sois le premier à voter ! · TOP 3 COMMUNAUTÉ · Aucun vote encore — sois le premier |
| `components\editor\ui\toolbar.tsx` | 3 | Aucun bloc ne correspond. · Insérer un bloc · Chercher un bloc à insérer |
| `components\admin\TranscriptionSearch.tsx` | 3 | ギニュー特戦隊, Kaméhaméha, 鳥山明… · Terme à chercher dans les planches · Effacer la recherche |
| `components\admin\TransformationsPanel.tsx` | 3 | Chargement des transformations échoué. · Aucune transformation pour l&apos;instant. · Éditer en détail |
| `components\admin\WikiHistory.tsx` | 3 | Aucune révision · système · Revenir à l'état précédent cette révision |
| `components\admin\WikiStudio.tsx` | 3 | Table non éditable ici · Retour à la liste · Entrée introuvable |
| `app\wiki\tournois\page.tsx` | 3 | Voir tous les Tournois &amp; Combats · Règles & Palmarès Canoniques · Encyclopédie |
| `app\wiki\techniques\page.tsx` | 3 | et des dictionnaires officiels ( · Encyclopédie · Techniques & Capacités |
| `app\wiki\techniques\[slug]\page.tsx` | 3 | Note canon / jeu vidéo · Lire le chapitre → · qui l'emploie, comment elle fonctionne et dans quelle planche elle apparaît |
| `app\wiki\puissances\page.tsx` | 3 | Doctrine de Shenron sur le Power Scaling : · Seuls les chiffres explicitement énoncés dans le manga d'Akira Toriyama ou arrêtés dans les guides officiels · Encyclopédie & Archives |
| `app\wiki\objets\[slug]\page.tsx` | 3 | Catégorie · Première Apparition Manga · Première Apparition Animée |
| `app\wiki\musiques\page.tsx` | 3 | Discographie & Thèmes Musicaux Officiels · Encyclopédie · Musiques, Génériques & Bandes Originales |
| `app\wiki\manga\page.tsx` | 3 | Tomes répertoriés · Chapitres indexés · Éditions du manga |
| `app\wiki\manga\volume\[id]\page.tsx` | 3 | Série&nbsp;: · Éditions répertoriées : · Tome précédent |
| `app\wiki\lieux\page.tsx` | 3 | Géographie & Cosmologie Canonique · (World Guide) et le · Encyclopédie |
| `app\wiki\episodes\page.tsx` | 3 | Synopses et métadonnées officielles collectées auprès de Toei Animation. · Séries disponibles · Séries du catalogue épisodes |
| `app\wiki\episodes\[id]\EpisodeScenes.tsx` | 3 | Sélectionnez plusieurs frames pour créer un GIF animé instantané. · URL de l'image ou capture d'écran · Sélectionner un fichier image de capture |
| `app\wiki\episodes\serie\[series]\EpisodeSeriesGrid.tsx` | 3 | Couverture de la série · Rechercher un épisode par titre ou par numéro · Titre ou numéro d'épisode… |
| `app\wiki\dragons\page.tsx` | 3 | Loi sacrée des Dragon Balls : · Encyclopédie · Dragons Sacrés & Registre des Vœux |
| `app\tierlists\page.tsx` | 3 | Sois le premier à classer l'univers Dragon Ball ! · Communauté · Classe l'univers Dragon Ball — créées et partagées par la communauté |
| `app\sources\dragon-ball\page.tsx` | 3 | Toutes les classifications · Méthode et provenance · Pagination des sources BXC |
| `app\personas\page.tsx` | 3 | Le bot Shenron · Les six gardiens · Six rôles, un seul client Gateway. Chaque gardien tient une fonction du bot. |
| `app\news\page.tsx` | 3 | Les actus officielles Dragon Ball sont importées avec leur lien canonique. · Voir les sources BXC → · Actualités |
| `app\ask\page.tsx` | 3 | Réinitialiser · Effacer la conversation · Votre question sur l'univers Dragon Ball |
| `app\admin\wiki\WikiManager.tsx` | 3 | Complétude · Créer une entrée · Rechercher une page ou une catégorie… |
| `app\admin\webhooks\page.tsx` | 3 | Tous les salons du serveur · Couleur de la barre · Nom affiché dans Discord |
| `app\admin\tickets\page.tsx` | 3 | Récupération des tickets. · AUCUN TICKET · Ouvrir le salon du ticket dans Discord |
| `app\admin\services\page.tsx` | 3 | Chargement des fonctionnalités… · Fonctionnalités du bot · Paramètres JSON |
| `app\admin\db-universe\games\page.tsx` | 3 | Aucun jeu enregistré · Les jeux s&apos;affichent ici une fois importés. · Jeux vidéo |
| `app\admin\db-universe\episodes\page.tsx` | 3 | Épisodes · Ajouter un épisode · Choisir une série |
| `app\admin\console\BotConsole.tsx` | 3 | Impossible de charger les salons. · Aucun message récent. · Message envoyé par le bot Shenron… |
| `app\admin\canvas\themes\page.tsx` | 3 | THÈMES DE CARTE · Comment ça marche ? · AUCUN THÈME |
| `app\admin\canvas\themes\ThemeForms.tsx` | 3 | + Nouveau thème carte · ACTIVÉ · Nom affiché |
| `app\admin\bot\page.tsx` | 3 | Bot Discord unifié · Login désactivé. · État |
| `app\admin\banners\BannersEditor.tsx` | 3 | Séries · Bannière par défaut · fallback — séries inconnues |
| `components\CommandPalette.tsx` | 2 | Un personnage, une saga, une technique, un épisode… · Réponse rédigée et sourcée sur le wiki |
| `components\ReportButton.tsx` | 2 | Signaler une erreur · Ex : l'image de Goku ne se charge pas, le lien vers la saga X est cassé, une info est fausse… |
| `components\SiteNav.tsx` | 2 | TV & Médias · Communauté |
| `components\wiki\BattlesGrid.tsx` | 2 | Rechercher un combat légendaire · Rechercher un combat, un combattant, une technique (ex: Genkidama, Namek, Gohan)... |
| `components\wiki\CharacterPowerScaling.tsx` | 2 | Sature le capteur magique · Seuil Destruction Planétaire |
| `components\wiki\ItemsGrid.tsx` | 2 | Rechercher un objet ou une technologie · Rechercher un objet, un inventeur, un véhicule (ex: Radar, Senzu, Bulma, Capsule)... |
| `components\wiki\StaffMatrixExplorer.tsx` | 2 | Rechercher un membre de l'équipe · Rechercher un éditeur, scénariste, animateur, seiyū, compositeur (ex: Torishima, Maeda, Borg, Kikuchi)... |
| `components\wiki\TechniqueFamiliesView.tsx` | 2 | HIÉRARCHIE DES FAMILLES D&apos;ATTAQUES &amp; ÉCOLES MARTIALES · Aucune technique appariée dans ce filtre. |
| `components\wiki\WikiCategoryNav.tsx` | 2 | Catégories de l'encyclopédie · Cette section n'est pas ouverte |
| `components\stream\MediaCatalogRails.tsx` | 2 | Épisodes à découvrir · Films à voir |
| `components\stream\StreamRail.tsx` | 2 | Défiler vers la gauche · Défiler vers la droite |
| `components\ratings\EntityRating.tsx` | 2 | Enregistré ! · Voir les notes et avis |
| `components\manga\MangaDialogueSearch.tsx` | 2 | Petit cœur · Recherche momentanément indisponible. Réessaie. |
| `components\manga\VolumeChaptersList.tsx` | 2 | À compléter · Choisir l'édition à lire |
| `components\admin\DbCrud.tsx` | 2 | Nouvelle entrée · Modifier l'entrée |
| `components\admin\GameMediaPanel.tsx` | 2 | Type de média · Ouvrir la vidéo |
| `components\admin\ImageField.tsx` | 2 | Glisser-déposer · Aucune image trouvée. |
| `app\global-error.tsx` | 2 | Une erreur critique est survenue · L'application a rencontré un problème inattendu. |
| `app\wiki\voix\page.tsx` | 2 | Comment lire cette page · Encyclopédie |
| `app\wiki\romans\page.tsx` | 2 | Statut Canonique des Écrits Dérivés · Archives & Publications Écrites |
| `app\wiki\romans\[id]\page.tsx` | 2 | Auteur / Novélisation · Pages Numérisées |
| `app\wiki\lieux\[slug]\page.tsx` | 2 | Première apparition Manga · Première apparition Anime |
| `app\wiki\films\page.tsx` | 2 | Couverture du catalogue vidéo · Catégories du catalogue films |
| `app\wiki\arcs\page.tsx` | 2 | Aucun arc répertorié. · Encyclopédie |
| `app\tierlists\creer\page.tsx` | 2 | Créer une tierlist · Choisis un thème pour commencer. |
| `app\news\[slug]\page.tsx` | 2 | Thèmes · À lire ensuite |
| `app\news\rss.xml\route.ts` | 2 | Le Journal — Dragon Ball France · Sorties anime, chapitres du manga, films, événements et analyses Dragon Ball. |
| `app\leaderboard\page.tsx` | 2 | Communauté Discord · Classement des guerriers |
| `app\jeux\page.tsx` | 2 | Arène de combat · Mise ton ki, encaisse les Zénis. |
| `app\jeux\2048\DragonBall2048.tsx` | 2 | Tu as été vaincu ! · flèches directionnelles |
| `app\commands\page.tsx` | 2 | Rechercher une commande · Rechercher une commande... |
| `app\admin\wiki\todo\page.tsx` | 2 | Tout est complet · Rubriques à compléter |
| `app\admin\wiki\contributions\page.tsx` | 2 | Contributions de la communauté · Réponse au contributeur |
| `app\admin\wiki\category\new\page.tsx` | 2 | NOUVELLE CATÉGORIE · — Aucune (racine) — |
| `app\admin\visibilite\page.tsx` | 2 | Visibilité · Afficher / masquer chaque entité du wiki sur le site public |
| `app\admin\signalements\page.tsx` | 2 | Impossible de charger les signalements. · Les remontées des membres apparaîtront ici. |
| `app\admin\posts\page.tsx` | 2 | Programmé · Publié |
| `app\admin\messages\page.tsx` | 2 | Récupération des messages automatiques. · Message enregistré. |
| `app\admin\lancement\LaunchManager.tsx` | 2 | Retirer ce rôle · — Ajouter un rôle — |
| `app\admin\db-universe\databooks\page.tsx` | 2 | Aucune entrée · Ajouter une entrée |
| `app\admin\databooks\[id]\page.tsx` | 2 | Aucune planche · Métadonnées, couverture, description, gestion des slots |
| `app\admin\commandes\CommandRunner.tsx` | 2 | Sélectionne une commande à gauche pour l&apos;exécuter. · Aucun paramètre. |
| `app\admin\commandes\page.tsx` | 2 | EXÉCUTER UNE COMMANDE · Toutes |
| `app\admin\agents\page.tsx` | 2 | Aucun appel pour l&apos;instant. · Requête |
| `lib\couverture.ts` | 1 | Volutes de fond de case : lobes bombés finis en spirales rentrantes, relevés sur la couverture du tome. |
| `components\AdminNavLinks.tsx` | 1 | Administration & sections masquées (Staff) |
| `components\ConsentGate.tsx` | 1 | Préférences de confidentialité |
| `components\DiscordInviteFAB.tsx` | 1 | Rejoindre le Discord |
| `components\GamePageLayout.tsx` | 1 | Arène de combat |
| `components\GatedClientLink.tsx` | 1 | Cette section n'est pas ouverte |
| `components\GatedLink.tsx` | 1 | Cette section n'est pas ouverte |
| `components\wiki\CharacterFilterModal.tsx` | 1 | Aucun résultat. |
| `components\wiki\CharacterSagaVariants.tsx` | 1 | cité |
| `components\wiki\ChronologyAtlas.tsx` | 1 | Databooks et guides qui accompagnent les dates, les personnages et la continuité. |
| `components\wiki\ChronologyTimeline.tsx` | 1 | Rechercher un titre dans la chronologie |
| `components\wiki\FilterDropdown.tsx` | 1 | Aucune option. |
| `components\wiki\LocationsGrid.tsx` | 1 | Rechercher un sanctuaire, une planète, une cité (ex: Kame House, Karin, Namek, Zeno)... |
| `components\wiki\RepriseLecture.tsx` | 1 | Reprendre la lecture |
| `components\wiki\TechniqueGrid.tsx` | 1 | Familles d&apos;Évolution |
| `components\wiki\TournamentsGrid.tsx` | 1 | Rechercher un tournoi, un vainqueur, une saga (ex: Tenkaichi, Cell Game, Gokū, Satan)... |
| `components\wiki\TransformationTreesView.tsx` | 1 | ARBORESCENCE &amp; FAMILLES D&apos;ÉVOLUTION DES TRANSFORMATIONS |
| `components\wiki\UniverseTabs.tsx` | 1 | Entrées de l'encyclopédie |
| `components\wiki\WikiPrevNext.tsx` | 1 | Précédent |
| `components\wiki\WikiSectionsReader.tsx` | 1 | Catégories de la fiche |
| `components\social\EntityParticipation.tsx` | 1 | Proposer une correction relue par la modération |
| `components\social\LikeButton.tsx` | 1 | Connecte-toi pour aimer |
| `components\manga\AccesApi.tsx` | 1 | Accès API |
| `components\episodes\OffreLegale.tsx` | 1 | Regarder légalement |
| `components\episodes\VideoLecteurs.tsx` | 1 | Version (VF, VOSTFR, VO sous-titrée) |
| `components\episodes\VideoUnavailableCard.tsx` | 1 | Source vidéo indisponible |
| `components\editor\Editor.tsx` | 1 | Aucun aperçu disponible. |
| `components\editor\ui\slash.tsx` | 1 | Insérer un bloc |
| `components\editor\markdown\serialize.ts` | 1 | Vidéo YouTube |
| `components\contest\MemberLedger.tsx` | 1 | ↳ réponse |
| `components\admin\GalerieMedias.tsx` | 1 | Chercher la fiche à rattacher… |
| `components\admin\MarkdownField.tsx` | 1 | L&apos;aperçu s&apos;affiche ici… |
| `components\admin\RythmeSparkline.tsx` | 1 | Dépôts sur 30 jours |
| `components\admin\SmartField.tsx` | 1 | — Aucun — |
| `components\admin\UserSelect.tsx` | 1 | Aucun membre trouvé. |
| `components\admin\WikiEntityPreview.tsx` | 1 | Aperçu de la page |
| `app\error.tsx` | 1 | Quelque chose s'est mal passé. |
| `app\not-found.tsx` | 1 | Cette page s'est perdue dans le néant cosmique. |
| `app\wiki\transformations\page.tsx` | 1 | Encyclopédie |
| `app\wiki\transformations\[slug]\page.tsx` | 1 | Cette forme n'a pas encore d'article |
| `app\wiki\tools\page.tsx` | 1 | Communauté |
| `app\wiki\sagas\error.tsx` | 1 | Les sagas n'ont pas pu s'afficher |
| `app\wiki\races\page.tsx` | 1 | Encyclopédie |
| `app\wiki\races\[slug]\page.tsx` | 1 | ses traits, son monde d'origine et ce que les sources en établissent |
| `app\wiki\personnages\page.tsx` | 1 | Encyclopédie |
| `app\wiki\personnages\[slug]\page.tsx` | 1 | Planète |
| `app\wiki\objets\page.tsx` | 1 | Encyclopédie & Archives |
| `app\wiki\manga\error.tsx` | 1 | Le manga n'a pas pu s'afficher |
| `app\wiki\jeux\error.tsx` | 1 | Les jeux n'ont pas pu s'afficher |
| `app\wiki\interviews\page.tsx` | 1 | Parcours éditorial |
| `app\wiki\films\error.tsx` | 1 | Les films n'ont pas pu s'afficher |
| `app\wiki\episodes\error.tsx` | 1 | Les épisodes n'ont pas pu s'afficher |
| `app\wiki\episodes\[id]\page.tsx` | 1 | cet épisode |
| `app\wiki\episodes\serie\[series]\page.tsx` | 1 | Épisodes Dragon Ball |
| `app\wiki\databooks\page.tsx` | 1 | Parcours éditorial |
| `app\wiki\databooks\[id]\page.tsx` | 1 | Catégorie |
| `app\wiki\corriger\page.tsx` | 1 | Proposer une correction |
| `app\wiki\chronologie\page.tsx` | 1 | Chronologie complète |
| `app\wiki\canon\error.tsx` | 1 | La vérification de canonicité n'a pas pu s'afficher |
| `app\tierlists\mes\page.tsx` | 1 | Gère et supprime tes classements. |
| `app\sources\dragon-ball\[sourceId]\page.tsx` | 1 | Extrait collecté |
| `app\shop\error.tsx` | 1 | La boutique n'a pas pu s'afficher |
| `app\profil\error.tsx` | 1 | Le profil n'a pas pu s'afficher |
| `app\profil\[id]\page.tsx` | 1 | Rôle et distinctions |
| `app\plan-du-site\page.tsx` | 1 | Tout ce que contient le site, regroupé par ce que tu viens y chercher. Les rubriques encore en préparation n'apparaissent pas : chaque lien ci-dessous mène à une page réelle. |
| `app\news\error.tsx` | 1 | Le Journal n'a pas pu s'afficher |
| `app\news\theme\[tag]\page.tsx` | 1 | Thème |
| `app\leaderboard\error.tsx` | 1 | Le classement n'a pas pu s'afficher |
| `app\jeux\pfc\PfcGame.tsx` | 1 | défaut : 100 z win / 50 z loss |
| `app\jeux\morpion\MorpionGame.tsx` | 1 | défaut : 100 z win / 50 z loss |
| `app\favoris\FavoritesList.tsx` | 1 | Aucun favori pour l&apos;instant. |
| `app\favoris\page.tsx` | 1 | Ce que tu as mis de côté. Conservé sur cet appareil — connecte-toi pour le retrouver partout. |
| `app\classements\error.tsx` | 1 | Les classements n'ont pas pu s'afficher |
| `app\canvas\page.tsx` | 1 | Le bot génère des images PNG/WebP/AVIF via Skia (napi-rs). Aperçus live depuis l'API publique. |
| `app\admin-access\AdminAccessForm.tsx` | 1 | Token d'accès administrateur |
| `app\admin-access\page.tsx` | 1 | Accès administrateur |
| `app\admin\wiki\category\[id]\page.tsx` | 1 | — Aucune (racine) — |
| `app\admin\visibilite\VisibilityManager.tsx` | 1 | Erreur de chargement. Réessaie. |
| `app\admin\transcriptions\page.tsx` | 1 | Supervision du corpus manga et databooks · Arbitrage des défauts OCR et relecture multi-agents |
| `app\admin\tierlists\page.tsx` | 1 | AUCUNE TIER LIST |
| `app\admin\tierlists\[id]\page.tsx` | 1 | ÉDITER |
| `app\admin\moderation\commentaires\page.tsx` | 1 | Voir le fil public |
| `app\admin\leaderboards\page.tsx` | 1 | Impossible de charger le classement. |
| `app\admin\lancement\page.tsx` | 1 | ACCÈS DES RUBRIQUES |
| `app\admin\events\page.tsx` | 1 | ÉVÉNEMENTS A2A |
| `app\admin\db-universe\sources\page.tsx` | 1 | Ajouter une source |
| `app\admin\db-universe\sagas\page.tsx` | 1 | Ajouter une saga |
| `app\admin\db-universe\films\page.tsx` | 1 | Aucun film enregistré |
| `app\admin\databooks\page.tsx` | 1 | Catalogue des 451 ouvrages officiels · Pilotage des campagnes de traduction FR et suivi de la qualité OCR |
| `app\admin\api-docs\StaffRoutes.tsx` | 1 | Méthode |
| `app\admin\a2a\page.tsx` | 1 | et boîtes aux lettres locales |
