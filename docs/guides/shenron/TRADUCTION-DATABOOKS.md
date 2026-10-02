# Pipeline de traduction des databooks

## Statut et périmètre

La chaîne traduit les planches japonaises déjà transcrites dans
`bot.db_databooks`, dépose uniquement les sorties validées dans PostgreSQL,
puis reconstruit le corpus RAG des databooks. PostgreSQL reste la source de
vérité ; `apps/bot/data/rag/corpus-databooks.json` est un artefact dérivé.

Le pipeline ne traduit jamais une transcription que le juge source classe
comme bruitée. Une page refusée par l'OCR doit d'abord repasser par une
correction ou une relecture de transcription : une traduction fluide d'une
source fausse serait une corruption éditoriale.

## Chaîne d'exécution

```text
PostgreSQL bot.db_databooks
        │
        ▼
planches-a-traduire.ts ── filtre OCR + shard + lexique japonais
        │
        ▼
traduction-boucle.ts
  Aphrody translate JA→FR → Aphrody chat/Agy → BXC/Google → NLLB local
        │
        ▼
juge unique + dépôt atomique + vérification source/image
        │
        ▼
ingest-databooks-rag.ts ── corpus japonais + français
        │
        ▼
apps/bot/data/rag/corpus-databooks.json
```

Le lexique Dragon Ball est extrait des tables du wiki et limité aux termes
présents dans le lot. Les termes sont masqués avant traduction puis restaurés
strictement ; un jeton perdu, une copie japonaise, une glose, une boucle ou un
artefact OCR fait refuser la page.

Le moteur dédié `aphrody-translate` est détecté automatiquement (binaire local,
`APHRODY_TRANSLATE_BIN` ou binaire de release). Son contrat one-shot
`--source ja --target fr --backend google` est protégé par des marqueurs `QXZ` à
quatre chiffres (`QXZ0001`). Cette largeur fixe évite qu'un terme suivi d'un
chiffre, comme `サイヤ人3`, ne devienne un jeton ambigu ; la restauration lit le
marqueur attendu dans la table avant de laisser passer le chiffre source. Le binaire Aphrody
contient également le correctif UTF-8 qui empêchait le scan de certains textes
japonais longs de paniquer.

### OCR des pages source

Le moteur de transcription est exposé par le CLI Aphrody compilé avec la
feature `ocr`, sous `aphrody ocr shenron`. Les actions `emit`, `verify`,
`deposit` et `pipeline` sont décrites par `aphrody ocr shenron --help`.
Le vérificateur et le dépôt appellent les scripts Shenron du checkout local :
Shenron reste le juge final et l'unique écrivain éditorial. Cette étape OCR est
distincte de la traduction JA→FR ci-dessous.

## Commandes canoniques

Toutes les commandes s'exécutent avec Bun, jamais avec Node :

```powershell
# Vérification sans écriture
bun run pipeline translate --dry-run

# Session complète : 4 shards, lots de 8, dépôt et RAG
bun scripts/ops/translate-databooks-session.ts --workers 4 --batch 8

# État éditorial PostgreSQL
bun scripts/ops/translate-databooks-corpus.ts --statut

# Réindexation seule après une interruption du tunnel
bun packages/pipeline/scripts/ingest-databooks-rag.ts
```

Le superviseur crée `var/runs/<run-id>/` avec le manifeste, les journaux des
lanes, les résultats et le journal d'ingestion. Un run est `completed` seulement
si toutes les lanes et l'ingestion RAG terminent avec le code 0. Une erreur
devient `failed`, jamais un manifeste `running` laissé silencieusement.

## Reprise, parallélisme et arrêt sûr

- Le hash stable `databookId:page` attribue chaque planche à une seule lane.
- Les fichiers temporaires portent l'identifiant du worker ; deux lanes ne se
  partagent pas leur file.
- Chaque lane maintient une quarantaine locale des pages refusées pendant la
  session. Cela empêche une boucle infinie, sans supprimer ni modifier la page
  en base ; une prochaine session peut la retenter avec un autre moteur.
- Le démarrage BXC est décalé entre lanes pour éviter la course de bootstrap.
- Avant un arrêt manuel, vérifier les processus réellement enfants du
  superviseur :

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'bun.exe'" |
  Where-Object { $_.CommandLine -match 'translate-databooks-session|traduction-boucle|planches-a-traduire' }
```

Ne tuer que les PID enfants d'un run identifié. Un tunnel SSH n'est pas un
worker : il ne doit être arrêté que s'il est zombie ou si son port refuse les
connexions. Après un tunnel DB interrompu, relancer l'ingestion seule ; les
traductions déjà déposées restent acquises.

## Preuve de la dernière session complète

La campagne suivante est la dernière campagne opérée et **n'est pas complète**.

Run : `databook-translation-20260924235829`

- Arrêt opérateur après la fin des lanes 1 et 2 ; manifeste final : `stopped`.
- Tous les processus Bun du run et le tunnel SSH ont été arrêtés puis vérifiés
  absents. L'ingestion RAG a été exécutée séparément après l'arrêt.
- PostgreSQL après reprise : 470 ouvrages, 17 369 pages, 16 402 JA, 11 318 FR.
  Restent 2 556 pages éligibles et 2 528 refusées par le juge source/OCR.
- RAG : 24 775 documents, 10 286 traductions ; artefact
  `apps/bot/data/rag/corpus-databooks.json`.

La session complète précédente reste conservée ci-dessous comme preuve
historique ; elle ne doit pas être utilisée pour déduire les compteurs actuels.

Run historique : `databook-translation-20260924233856`

- 4 lanes, batch 8 ; lanes 1 à 4 : code 0.
- Durée observée : environ 10 minutes.
- Ingestion RAG : `completed`.
- Artefact : `apps/bot/data/rag/corpus-databooks.json`.
- Dernier journal d'ingestion : 24 659 documents, 14 063/15 086 planches
  retenues, 1 023 écartées par le juge, 10 170 traductions indexées.

Les compteurs PostgreSQL globaux doivent être relus avec
`translate-databooks-corpus.ts --statut` lorsque le tunnel `15433` est sain.
Ils ne doivent pas être déduits du seul nombre de documents RAG : les ouvrages
masqués, les pages rejetées et les fiches d'ouvrages ont des périmètres
différents.

## Blocages connus et traitement

Les pages exclues par le juge source sont un blocage de transcription, pas un
échec du moteur de traduction. La procédure correcte est :

1. corriger ou relire l'OCR sur l'image originale ;
2. déposer la transcription révisée avec la garde source/image ;
3. relancer la session de traduction ;
4. réindexer le RAG et vérifier les compteurs.

Un tunnel PostgreSQL peut aussi mourir après la fin des workers. Dans ce cas,
la traduction est conservée, le superviseur marque l'ingestion en échec et la
commande d'ingestion seule est la reprise prévue. Ne pas relancer toute la
traduction pour réparer ce problème de transport.
