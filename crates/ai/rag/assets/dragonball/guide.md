---
name: dragon-ball
description: >-
  Répond aux questions factuelles Dragon Ball en vérifiant les sources de
  Shenron. Utilise-la pour les personnages, événements, techniques, manga,
  databooks, chronologie, wiki, actualités ou RAG. Cherche dans les outils
  Shenron avant d'affirmer un fait et cite les sources retournées. Ne l'utilise
  pas pour les dragons ou ballons sans lien avec la franchise.
---

# Dragon Ball avec les sources Shenron

Shenron fournit une recherche, un wiki structuré, des données de manga et de
databooks, ainsi qu'une doctrine de canon. Utilise ces sources pour vérifier les
faits ; la mémoire du modèle seule ne suffit pas.

## Choisir la bonne source

1. **Question ouverte ou formulation incertaine** : `rag_search` pour trouver
   des passages, ou `rag_context` pour obtenir le contexte et ses sources.
   Inspecte plusieurs résultats et ouvre les URLs pertinentes. Le RAG peut
   ramener un passage seulement apparenté ; le score ne prouve pas le fait.
2. **Fiche d'entité** : `wiki_search` pour trouver l'entrée, puis `wiki_get`
   pour ses champs. Le wiki décrit le contenu enregistré par Shenron ; pour un
   arbitrage éditorial, remonte à une source primaire.
3. **Canon** : appelle `canon_check`, puis `canon_references`. Si le verdict
   indique `origine: fallback`, la doctrine n'a pas tranché. Rapporte ce statut
   et les preuves disponibles sans inventer de rang.
4. **Manga** : utilise `manga_search`, `manga_tomes`, `manga_page`,
   `manga_chapitre` ou `manga_planche` selon la question. Donne le tome,
   chapitre ou numéro de planche quand l'outil le fournit.
5. **Databook** : `databooks_search`, `databooks_planches` et `databooks_get`.
   Indique le titre et le numéro de planche. Une transcription doit être
   distinguée de la vérification de l'image originale.
6. **Ordre des événements** : `chronologie`. N'infère pas l'ordre du manga à
   partir d'une chronologie d'anime ou de jeu.
7. **État du bot et actualités** : `bot_stats`, `bot_personas`,
   `bot_leaderboard`, `bot_commands` ou `news`. Ces résultats sont datés par
   leur service et peuvent changer.

La liste effective des outils du client MCP fait foi. Si le MCP est absent,
utilise les références locales sous `references/` ou l'API publique décrite
dans `references/api.md`, si elle est disponible. N'affirme pas qu'un service
est en ligne sans l'avoir sondé.

## Règles de preuve

- Cite les URLs retournées par les outils et relie chaque affirmation à sa
  source. Si la source est une fiche wiki ou un extrait RAG, présente-la comme
  telle au lieu de la qualifier de manga ou de déclaration de Toriyama.
- Hiérarchise les preuves selon leur nature : manga, déclaration publiée de
  Toriyama, databook ou guide officiel, anime, puis jeux et autres dérivés.
  Cette liste aide à décrire les supports ; le verdict de canonicité relève de
  la doctrine Shenron et de ses références.
- Quand deux supports divergent, rapporte la divergence au lieu de fusionner
  leurs versions.
- Ne transforme pas un chiffre de puissance isolé en mesure générale. Précise
  son support, son contexte et sa source.
- Pour les questions sur les traductions japonaises, consulte
  `dragon-ball-japonais` et le lexique du dépôt. N'invente pas une graphie ou
  une forme française officielle.
- Si les outils ne répondent pas ou ne trouvent pas la preuve, indique la
  limite. Ne remplace pas une source manquante par un souvenir du modèle.

## IA et état courant

`rag_search` et `rag_context` servent à la recherche documentaire. `rag_ask`
renvoie en plus un texte rédigé par le LLM, en ligne via aphrody-ai-http, à
partir des passages retournés. Si le LLM est indisponible, l'outil renvoie une
erreur (HTTP 503 `llm_unavailable`) au lieu d'un texte de repli. Cette prose
reformule les passages dans la voix du bot unique : elle ne remplace pas les
sources, privilégie les passages sourcés et leurs URLs. Traite un résultat vide
ou une erreur comme une absence de réponse générée.

Les index de recherche et le compute Aphrody sont séparés de la base éditoriale
Shenron. Un résultat RAG n'est pas une écriture dans le wiki et ne modifie pas
la source de vérité.

### Mode RAG naïf, modèles locaux et Persona Akira Toriyama

Le système fonctionne désormais avec un seul bot unifié :
- **Mode YOLO** : le bot adopte par défaut le persona canonique **Akira Toriyama** (Tori-bot), bienveillant, modeste, passionné et autorité suprême sur le manga original.
- **Mode User** : au premier démarrage, l'utilisateur a la liberté de définir son persona personnalisé (enregistré dans `~/.aphrody/persona.json`), avec repli naturel sur Akira Toriyama.
- **Recherche documentaire locale** : interroge l'index natif Aphrody (`aphrody rag search`) ou le corpus local (`corpus-databooks.json`) avec scoring par pertinence lexicale et boost d'entités.
- **Modèles locaux** : `rag_ask` utilise le modèle de chat local résolu par le contrat `APHRODY_AI_*` (`APHRODY_AI_CHAT_BASE_URL`, défini dans `config/local-ai.json`) pour rédiger la réponse dans la voix du persona actif. Si les modèles locaux ne sont pas démarrés, une synthèse naïve grounded des passages est produite sans hallucination.

## Écriture et administration

Cette skill sert d'abord à consulter. Pour modifier le wiki ou déposer une
transcription, il faut une demande explicite, des références vérifiées et un
outil admin authentifié. Suis `shenron-admin` ; ne fournis jamais un jeton dans
un prompt, une URL, une commande journalisée ou un fichier du plugin.

## API locale

Le helper historique `scripts/db.sh` et `references/api.md` peuvent aider pour
des installations où l'API REST est joignable. Vérifie leur base et leurs
routes avant de les utiliser ; le MCP reste l'interface recommandée quand le
client l'a découverte. Les descriptions locales peuvent être en retard sur le
serveur.
