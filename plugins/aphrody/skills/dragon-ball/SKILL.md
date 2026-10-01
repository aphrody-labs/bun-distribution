---
name: dragon-ball
description: "Répond aux questions de faits Dragon Ball (personnage, technique, saga, manga, databook, canon) avec les outils dragonball_* ou l'API dragonballfr.com, sources citées. À utiliser avant toute réponse factuelle ; jamais de mémoire seule."
---

# Dragon Ball avec les sources Shenron

> **S'applique quand :** le serveur MCP `aphrody-kernel` est connecté (outils `dragonball_*`) ou l'API publique `https://bot.dragonballfr.com` est joignable. **Sinon :** utilise l'API REST décrite dans `references/api.md` ; si rien n'est joignable, dis que le fait n'est pas établi et laisse le champ vide, sans le remplir de mémoire.

Shenron fournit une recherche, un wiki structuré, des données de manga et de
databooks, ainsi qu'une doctrine de canon. Utilise ces sources pour vérifier les
faits ; la mémoire du modèle seule ne suffit pas.

## Choisir la bonne source

Les noms ci-dessous sont ceux des outils MCP `dragonball_*` (Claude Code les
expose sous `mcp__plugin_aphrody_aphrody__dragonball_<nom>` ; le serveur les
enregistre sous la forme `dragonball.<nom>`).

1. **Question ouverte ou formulation incertaine** : `dragonball_rag_search`
   pour trouver des passages, ou `dragonball_rag_context` pour obtenir le
   contexte et ses sources. Inspecte plusieurs résultats et ouvre les URLs
   pertinentes. Le RAG peut ramener un passage seulement apparenté ; le score
   ne prouve pas le fait. `dragonball_sources` et `dragonball_data_coverage`
   disent ce qui est indexé : une recherche vide sur un corpus absent ne prouve
   rien.
2. **Fiche d'entité** : `dragonball_wiki_search` pour trouver l'entrée, puis
   `dragonball_wiki_get` pour ses champs (`dragonball_wiki_categories` et
   `dragonball_wiki_list` pour parcourir). Le wiki décrit le contenu enregistré
   par Shenron ; pour un arbitrage éditorial, remonte à une source primaire.
3. **Canon** : `dragonball_canon_check`, puis `dragonball_canon_references`
   (détails dans la skill `dragon-ball-canon`). Si le verdict indique
   `origine: fallback`, la doctrine n'a pas tranché. Rapporte ce statut et les
   preuves disponibles sans inventer de rang.
4. **Manga** : `dragonball_manga_search`, `dragonball_manga_tomes`,
   `dragonball_manga_page`, `dragonball_manga_chapitre`,
   `dragonball_manga_planche` ou `dragonball_manga_recherche` selon la
   question. Donne le tome, chapitre ou numéro de planche quand l'outil le
   fournit. `dragonball_manga_scanlate` (analyse Koharu : OCR, traduction,
   nettoyage) exige la fonctionnalité Koharu et ses modèles : ne l'annonce pas
   sans l'avoir essayé.
5. **Databook** : `dragonball_databooks_search` (fiches d'ouvrages : titre,
   auteur, description), `dragonball_databooks_planches` (expression dans le
   texte transcrit des planches) et `dragonball_databooks_get` (détail d'un
   ouvrage). Indique le titre et le numéro de planche. Une transcription doit
   être distinguée de la vérification de l'image originale.
   `dragonball_databooks_scanlate` : mêmes réserves que `manga_scanlate`.
6. **Ordre des événements** : `dragonball_chronologie` (filtres `era`, `kind`).
   N'infère pas l'ordre du manga à partir d'une chronologie d'anime ou de jeu.
7. **État du bot et actualités** : `dragonball_bot_stats`,
   `dragonball_bot_personas`, `dragonball_bot_leaderboard`,
   `dragonball_bot_commands` ou `dragonball_news`. Ces résultats sont datés par
   leur service et peuvent changer.
8. **Délégation A2A** : `dragonball_a2a_send`, `dragonball_a2a_task_status`,
   `dragonball_a2a_task_list`, `dragonball_a2a_agent_card`. `a2a_send` dépose une
   tâche (effet externe) : seulement sur demande.

Ces 32 outils publics et les 5 outils `dragonball_admin_*` (voir
`shenron-admin`) sont enregistrés dans `crates/ai/mcp/src/main.rs`, derrière la
fonctionnalité Cargo `dragonball` du crate `aphrody-mcp`. La liste effective des
outils du client MCP fait foi : un binaire construit sans cette fonctionnalité
ne les expose pas. Si le MCP est absent, utilise les références locales sous
`references/` ou l'API publique décrite dans `references/api.md`, si elle est
disponible. N'affirme pas qu'un service est en ligne sans l'avoir sondé.

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

`dragonball_rag_search` et `dragonball_rag_context` servent à la recherche
documentaire. `dragonball_rag_ask` renvoie en plus un texte rédigé par le LLM à
partir des passages retournés (route bot `/api/public/rag/chat`). Si le LLM est
indisponible, l'API répond par une erreur (`llm_unavailable`) au lieu d'un texte
de repli ; avec `APHRODY_AUTO_FALLBACK=1`, l'outil se replie sur le corpus
local, dont il indique le mode. Cette prose
reformule les passages dans la voix d'un persona : elle ne remplace pas les
sources, privilégie les passages sourcés et leurs URLs. Traite un résultat vide
ou une erreur comme une absence de réponse générée.

Les index de recherche et le compute Aphrody sont séparés de la base éditoriale
Shenron. Un résultat RAG n'est pas une écriture dans le wiki et ne modifie pas
la source de vérité.

Avec `local: true` (ou `SHENRON_LOCAL_RAG=1`), les outils `dragonball_rag_*`
interrogent le corpus local d'Aphrody au lieu de l'API du bot. Vérifie le mode retourné et ouvre la source liée avant de citer un
résultat. L'index disponible peut ne pas contenir les pages de manga : une
recherche vide ne permet aucune conclusion sur le contenu de ces pages. Pour
les lacunes de bibliographie du wiki, suis le flux ciblé et révisé de
`shenron-admin` ; ne déduis pas une citation d'un score RAG.

## Écriture et administration

Cette skill sert d'abord à consulter. Pour modifier le wiki ou déposer une
transcription, il faut une demande explicite, des références vérifiées et un
outil admin authentifié. Suis `shenron-admin` ; ne fournis jamais un jeton dans
un prompt, une URL, une commande journalisée ou un fichier du plugin.

## API locale

Le helper `db.sh` (dossier `scripts/` de cette skill, enveloppe `curl` + `jq`)
et `references/api.md` aident quand l'API REST est joignable ; sondage du
2026-10-01 : `GET /api/public/rag/search` répondait `index_unavailable` à ce
moment-là, ce qui rappelle de lire `error`/`mode` avant de conclure. Vérifie leur base et leurs
routes avant de les utiliser ; le MCP reste l'interface recommandée quand le
client l'a découverte. Les descriptions locales peuvent être en retard sur le
serveur.
