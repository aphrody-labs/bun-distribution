---
title: "Assets et CDN"
description: "Contrat unique de publication, d'URL et de cache des assets Rose Griffon"
scope: ["assets", "cdn", "website", "cron"]
status: "stable"
---

# Assets et CDN

## Source de vérité

`packages/assets/public/` est la seule source versionnée des visuels communs :
logos Rose Griffon, identités des projets, images Open Graph, icônes, fonds et
polices. Le paquet `@rosegriffon/assets` expose à la fois ces fichiers et les
helpers d'URL client-safe. Une application ne copie pas ces fichiers dans son
propre `public/` pour les publier.

Les assets se répartissent volontairement en trois classes :

| Classe | Source | URL publique | Responsable |
| --- | --- | --- | --- |
| Communs / marque | `packages/assets/public/` | `https://cdn.rosegriffon.fr/static/rg/public/<fichier>` | tâche cron `cdn` |
| Données du jeu Azalée | extraction CPK et services `niers` | `https://cdn.rosegriffon.fr/static/azalee/...`, `/dx11`, `/model-*`, `/audio`, etc. | pipeline de données du jeu |
| Fichiers utilisateurs | buckets Storage | URL Storage signée ou publique selon le bucket | service Storage |

Les deux dernières classes ne doivent jamais être déplacées dans le paquet
d'assets : elles ont une provenance, un volume, des droits d'accès et un cycle
de renouvellement différents.

## Contrat de code

Ne pas écrire l'origine CDN en dur dans une application. Importer les helpers
depuis `@rosegriffon/assets` :

```ts
import { cdnOrigin, gameAssetUrl, sharedAssetUrl } from "@rosegriffon/assets";

const cdn = cdnOrigin(process.env.NEXT_PUBLIC_CDN_ORIGIN);
const logo = sharedAssetUrl("RG_Logo_V2.5.webp");
const classSprite = gameAssetUrl("menu/200_icon/06_icon_class/icon_class_s.webp");
```

`cdnOrigin()` accepte une origine HTTP(S) sans chemin ; elle tombe sur
`https://cdn.rosegriffon.fr`. `sharedAssetUrl()` produit toujours le chemin
canonique `/static/rg/public`, et `gameAssetUrl()` le chemin `/static/azalee`.

## Publication et exploitation

La tâche `cdn` du package `@rosegriffon/cron` copie chaque fichier une seule
fois vers `${CDN_STATIC_ROOT:-/var/www/cdn/static}/rg/public`. Elle génère les
fichiers Brotli et gzip à côté du fichier source, puis ne recharge nginx et ne
purge le cache Cloudflare qu'en cas de changement.

Les variables utiles sont :

| Variable | Défaut | Usage |
| --- | --- | --- |
| `RG_ASSETS_SOURCE_DIR` | chemin du package `assets` relatif à la tâche | source locale, utile en CI ou conteneur |
| `CDN_STATIC_ROOT` | `/var/www/cdn/static` | racine de publication locale |
| `CDN_PUBLIC_BASE` | `https://cdn.rosegriffon.fr` | origine annoncée par l'API CDN |
| `NEXT_PUBLIC_CDN_ORIGIN` | origine CDN par défaut | override explicite du client Website |

Avant de déployer ce changement sur le VPS, publier ensemble `infra/nginx/cdn.rosegriffon.conf`
et `infra/systemd/rg-cron.service`, lancer `sudo nginx -t`, puis recharger nginx
et l'unité cron. Ne pas supprimer les anciens chemins `static/azalee/public` et
`static/website/public` avant la fin de leur rétention CDN et la vérification
des consommateurs historiques ; la nouvelle tâche n'y écrit déjà plus.

## Règles de contribution

- Ajouter un visuel commun sous `packages/assets/public/`, jamais dans deux apps.
- Utiliser un nom stable, sans écraser un fichier déjà publié ; le CDN applique
  un cache immutable d'un an.
- Préférer un nouveau nom versionné pour une modification incompatible.
- Ne pas ajouter d'archive, de source de montage ou de dump de jeu dans le CDN.
- Vérifier le format, les licences et la taille avant ajout ; les assets de jeu
  doivent rester générés et réversibles.
