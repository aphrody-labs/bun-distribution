---
name: web-xcom
description: "@aphrody/xcom x.com profile scraper (XComScraper): screenshots, AI extraction, aphrody web xcom profile CLI."
metadata:
  short-description: Scrape public x.com profile pages.
---

# @aphrody/xcom

Scraper de pages de profil x.com (`packages/web/x`).

## Surface

`XComScraper` → `XComProfileData`. CLI : `aphrody web xcom profile <handle>`, options
`--screenshot`, `--ai-extract`.

## À ne pas confondre avec @aphrody/x

| | `@aphrody/xcom` (cette skill) | `@aphrody/x` (skill `web-x-client`) |
|---|---|---|
| Voie d'accès | Page publique rendue | GraphQL + REST authentifiés par cookies |
| Besoin de session | Non | Oui |
| Portée | Un profil, tel qu'un visiteur le voit | Timeline, recherche, ranking local, decks |

Pour tout ce qui demande une session (publier, lire un fil complet, classer),
c'est `@aphrody/x` qu'il faut, pas ce scraper. `web-x-client` couvre ce cas.

`--ai-extract` envoie le contenu de la page à un modèle : le signaler quand on
l'active, et ne pas le poser par défaut dans un script.
