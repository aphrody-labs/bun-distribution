# Navigateur CPK — API et données, sans page dédiée

La **page** d'exploration de l'arborescence CPK de l'ancienne application
`apps/azalee` a été retirée (UI explorateur en double, `84461f04`) et ne doit
pas être recréée sous `/wiki`.

L'**API** et l'index qui l'alimentaient survivent, portés par
`packages/azalee/src/cpk/**` : `apps/website/src/app/api/cpk/route.ts`
(`GET /api/cpk?path=…`) les expose toujours à Website (consommé notamment par
`apps/website/src/lib/cutin/listing.ts`). Les services de recherche et de lecture des données réutilisent les
mêmes fonctions (`listDirPaged`, `searchFiles`, `fileMeta`). Artefact source :
`apps/website/data/cpk-index.ndjson.gz`, matérialisé en SQLite au premier
accès.

L'extraction, l'inspection des archives et les outils natifs appartiennent au
dépôt `niers`. Ce monorepo conserve uniquement les contrats de données requis
par le wiki `/wiki`; voir [azalee.md](azalee.md).
