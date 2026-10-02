# Databooks — transcription de masse et API

Chaîne complète pour transcrire les planches des databooks en texte via un
modèle local, puis réinjecter le résultat dans le site.

**État du corpus au 2026-08-21** : 318 fiches, 11 513 planches, dont **11 277
sans texte**. Les planches brutes pèsent 17 Gio (~1,5 Mio pièce).

---

## 1. Exporter des lots

```bash
cd ~/shenron/apps/site
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)" \
  bun scripts/export-databooks-ocr.ts --sortie ~/databooks-ocr --taille 400
```

| Option           | Défaut            | Rôle                                                 |
| ---------------- | ----------------- | ---------------------------------------------------- |
| `--sortie <dir>` | `~/databooks-ocr` | Racine des lots                                      |
| `--taille <n>`   | `400`             | Planches par lot                                     |
| `--lot <n>`      | —                 | N'exporter qu'un lot                                 |
| `--largeur <px>` | `1600`            | Redimensionnement (l'OCR n'a pas besoin de 4 000 px) |
| `--qualite <n>`  | `82`              | Qualité JPEG                                         |
| `--tout`         | non               | Inclure les planches déjà transcrites                |
| `--plan`         | non               | N'estime que le volume, n'écrit rien                 |
| `--force`        | non               | Refaire un lot déjà présent                          |

Chaque lot est autonome :

```
lot-001/
  manifeste.json     # entrées + format de réponse attendu
  images/1-0001.jpg  # <databookId>-<page sur 4 chiffres>.jpg
```

**Poids mesuré** : ~200 Kio par planche après réduction, soit **~2,3 Gio** pour
le corpus entier (contre 17 Gio en brut). Les lots déjà écrits sont sautés — la
commande est relançable.

Une entrée de `manifeste.json` :

```json
{
	"databookId": 1,
	"page": 1,
	"titre": "Dragon Ball Daizenshuu 1 — Complete Illustrations",
	"kind": "artbook",
	"categorie": "Art Book",
	"image": "images/1-0001.jpg"
}
```

---

## 2. Réinjecter les transcriptions

```bash
curl -X POST https://dragonballfr.com/api/databooks/1/transcription \
  -H "Authorization: Bearer $DATABOOKS_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"merge","pages":[{"number":1,"text":"…"},{"number":2,"text":"…"}]}'
```

- **`merge` (défaut)** — ne touche QUE le champ `text` des pages citées. L'image
  et les pages absentes du corps restent intactes. **Idempotent** : relancer le
  même lot ne change rien. C'est le mode à utiliser pour un traitement par lots.
- **`replace`** — remplace tout le tableau de pages. À réserver à une reprise
  complète ; les images non redonnées sont conservées depuis l'état précédent.
- `description` (facultatif) — chapô de la fiche, en markdown, rendu comme un
  article par `WikiMarkdown`.
- `"text": null` **efface** la transcription d'une page. Une chaîne vide ou
  blanche est en revanche **ignorée** : c'est presque toujours une planche que le
  modèle n'a pas su lire, et la traiter comme un effacement détruirait une bonne
  transcription au passage suivant.

Réponse :

```json
{
	"id": 1,
	"mode": "merge",
	"deposees": 2,
	"ignorees": 0,
	"pagesInconnues": 0,
	"pagesTotal": 40,
	"pagesTranscrites": 2
}
```

`pagesInconnues` > 0 signale un décalage entre le lot exporté et la base (fiche
modifiée entre-temps) : réexporter le lot concerné.

Chaque dépôt écrit une révision dans `public.wiki_revisions` — consultable et
**réversible** depuis `/admin/wiki/history`. Une transcription automatique est
une proposition, pas une vérité.

Limites : 40 000 caractères par planche, 2 000 pages par appel.

---

## 3. API databooks

Lecture publique, écriture par jeton porteur. CORS ouvert (`*`) : l'écriture est
protégée par le jeton, pas par l'origine.

| Méthode  | Route                                                     | Auth  |
| -------- | --------------------------------------------------------- | ----- |
| `GET`    | `/api/databooks?q=&kind=&category=&limit=&offset=&order=` | —     |
| `GET`    | `/api/databooks/:id`                                      | —     |
| `POST`   | `/api/databooks`                                          | jeton |
| `PATCH`  | `/api/databooks/:id`                                      | jeton |
| `DELETE` | `/api/databooks/:id`                                      | jeton |
| `POST`   | `/api/databooks/:id/transcription`                        | jeton |

- `q` fait une recherche **plein texte française** (titre, titre japonais,
  auteur, description), adossée à l'index GIN `db_databooks_fts`.
- `includeHidden=1` n'a d'effet qu'avec un jeton valide : une fiche masquée
  n'est jamais servie autrement.
- Jeton = `DATABOOKS_API_TOKEN`, repli sur `SHENRON_ADMIN_TOKEN`. **Sans jeton
  configuré, toute écriture est refusée** — jamais ouverte par défaut.

---

## 4. Index Redis

Miroir de lecture en base 4 (`dbfr:databook:*`), tenu à jour à chaque écriture
passant par l'API. Postgres reste la source de vérité ; une panne Redis ne fait
jamais échouer une écriture.

```bash
DATABASE_URL=… bun apps/site/scripts/index-databooks-redis.ts --purge
```

| Clé                             | Type          | Contenu                        |
| ------------------------------- | ------------- | ------------------------------ |
| `dbfr:databook:<id>`            | string (JSON) | fiche sérialisée + `pageCount` |
| `dbfr:databooks:all`            | set           | identifiants publiés           |
| `dbfr:databooks:kind:<kind>`    | set           | par type d'ouvrage             |
| `dbfr:databooks:category:<cat>` | set           | par catégorie éditoriale       |

---

## 5. MCP

Le serveur MCP public `mcp.dragonballfr.com` a été retiré. Le serveur unifié
`aphrody-mcp` expose les outils Dragon Ball en stdio local, avec les noms
qualifiés suivants :

- `dragonball.databooks_search` — recherche plein texte, renvoie les fiches sans les
  planches (une fiche peut en compter 300) ;
- `dragonball.databooks_get` — fiche détaillée, planches et transcriptions incluses
  (plafond `maxPages`, défaut 50).

Ces outils appellent l'API du site avec la configuration runtime Shenron de
`aphrody-mcp`; ils ne constituent pas une surface HTTP MCP publique. Utiliser
`tools/list` sur le binaire construit pour obtenir les schémas actifs. La
configuration de l'ancien hôte ne doit pas servir de cible client.
