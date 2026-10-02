# Prompt — transcription des databooks (Claude local)

À coller tel quel dans le Claude local qui dispose du modèle GPU de vision.

> **Avertissement** : `https://dragonballfr.com/wiki/databooks` est une page
> **gatée** — elle répond `307` vers `/wiki-bientot` pour un client non
> authentifié. Ne pas la scraper : tout passe par l'API JSON ci-dessous, qui est
> ouverte en lecture.

---

```
Tu transcris les planches des databooks Dragon Ball de dragonballfr.com en texte.

CONTEXTE
Le corpus compte 318 ouvrages (guides officiels, artbooks, interviews) et
11 513 planches scannées, dont 11 277 n'ont aucun texte. Ton travail : lire
l'image d'une planche et en restituer le texte.

OÙ TROUVER LE TRAVAIL
- Liste et recherche : GET https://dragonballfr.com/api/databooks?limit=50&offset=0
  Filtres : q= (plein texte), kind= (databook|interview|artbook), category=
- Une fiche et ses planches : GET https://dragonballfr.com/api/databooks/<id>
  Chaque page a { number, image, text }. `text: null` = à transcrire.
- Les images sont servies sur https://bot.dragonballfr.com/... (chemin `image`,
  préfixé `./assets/` → remplacer par https://bot.dragonballfr.com/assets/).
N'utilise PAS https://dragonballfr.com/wiki/databooks : cette page est fermée au
public et renvoie une redirection.

CE QUE TU RENDS
Pour chaque planche, le texte tel qu'il apparaît, en français quand la planche
est en français, sinon dans sa langue d'origine (beaucoup sont en japonais).
- Restitue les titres, encadrés, légendes, tableaux et bulles.
- Garde l'ordre de lecture naturel de la planche.
- Utilise du markdown léger : ## pour un titre de section, - pour une liste,
  **gras** pour un intitulé de fiche technique.
- N'invente RIEN. Une zone illisible : écris [illisible].
- Une planche sans aucun texte (illustration pleine page) : envoie
  "text": null — surtout pas une description de l'image. Une chaîne vide ou
  blanche est ignorée par l'API (elle protège les transcriptions existantes).
- Ne traduis pas de toi-même : transcris. La traduction est une autre étape.

COMMENT TU LE DÉPOSES
POST https://dragonballfr.com/api/databooks/<id>/transcription
Headers: Authorization: Bearer <DATABOOKS_API_TOKEN>
         Content-Type: application/json
Body:
{
  "mode": "merge",
  "pages": [
    { "number": 1, "text": "## Fiche de Son Goku\n- Taille : 175 cm\n..." },
    { "number": 2, "text": "" }
  ]
}

`mode: "merge"` ne touche que le champ `text` des pages citées : les images et
les pages absentes restent intactes, et relancer le même lot ne change rien.
Dépose par paquets de 20 à 50 pages, ouvrage par ouvrage.

VÉRIFIE TON DÉPÔT
La réponse renvoie { deposees, ignorees, pagesInconnues, pagesTranscrites }.
- `ignorees` > 0 : des entrées avaient un numéro invalide ou un texte vide.
- `pagesInconnues` > 0 : tu as envoyé un numéro de page qui n'existe pas dans la
  fiche — relis la fiche avant de continuer, ne réessaie pas à l'identique.

RYTHME
Un ouvrage à la fois, dans l'ordre des identifiants. Après chaque dépôt réussi,
passe au suivant. En cas d'erreur 5xx, attends 30 s et réessaie une fois ; si ça
échoue encore, note l'identifiant et continue avec le suivant.
```

---

## Mode « lot hors ligne »

Si le modèle local n'a pas d'accès réseau, exporter les planches en lots
autonomes (images réduites + manifeste), puis déposer les transcriptions
ensuite : cf. [`databooks-transcription.md`](databooks-transcription.md).

```bash
cd ~/shenron/apps/site
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)" \
  bun scripts/export-databooks-ocr.ts --sortie ~/databooks-ocr --taille 400
```

~200 Kio par planche après réduction, soit ~2,3 Gio pour le corpus entier.
