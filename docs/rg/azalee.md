---
title: "Azalée dans Website"
description: "Contrat canonique de la surface web Azalée et de son domaine historique"
scope: ["website", "wiki", "ops"]
status: "stable"
---

# Azalée dans Website

Azalée n'est plus une application web autonome. Le portail Rose Griffon et le
wiki IEVR sont une seule application Next.js : [`apps/website`](../apps/website).
Les pages du wiki sont servies sous `https://rosegriffon.fr/wiki`.

## Invariants

- Un seul code frontend : `apps/website`.
- Un seul `next build` : celui du workspace `@rosegriffon/website`.
- Une seule release bleu/vert : `website-web.service` et
  `website-web-b.service`.
- Aucun workspace `apps/azalee`, aucune unité `azalee-web`, aucun watchdog et
  aucun script `ship-azalee` ne doivent être recréés.
- `azalee.rosegriffon.fr` est uniquement une entrée de compatibilité. nginx
  redirige chaque requête vers le chemin correspondant sous
  `https://rosegriffon.fr/wiki` ; ce domaine ne déclenche aucun build.
- Une modification de la présentation, des routes ou des métadonnées du wiki
  se fait dans `apps/website`, puis est livrée avec Website.

## Ce qui conserve le nom Azalée

La fusion du frontend ne renomme pas les contrats métier. Le package
`@rosegriffon/azalee`, l'API de données, le profil du bot Discord et les jeux de
données IEVR peuvent conserver leur nom. Ce sont des producteurs ou des
consommateurs de données, pas des applications Next supplémentaires.

## Développement et publication

```bash
bun run website:dev
bun run deploy website
bun run deploy:status
```

Le changement est valide lorsque les pages `rosegriffon.fr/wiki/**` répondent
depuis la release Website et que le domaine historique retourne une redirection
permanente vers `/wiki`. Une commande ou une documentation proposant
`next build` dans `apps/azalee`, `deploy azalee` ou le redémarrage
d'`azalee-web.service` est obsolète et doit être supprimée.

## Responsabilités

| Sujet | Source de vérité |
| --- | --- |
| Routes et composants du wiki | `apps/website/src/app/wiki` et composants Website associés |
| Navigation, thèmes et préférences | `apps/website` et packages partagés |
| Données IEVR | packages de données et miroir documentés dans [architecture-unifiee-ievr.md](architecture-unifiee-ievr.md) |
| Publication frontend | [deploiement-sans-coupure.md](deploiement-sans-coupure.md) |
| Domaine historique | configuration nginx de redirection, sans upstream Azalée |
