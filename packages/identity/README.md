# @aphrody/identity (façade)

Ce paquet ne contient plus aucune logique du pet ni de l'avatar : `src/` ré-exporte le paquet canonique
`m3/packages/identity` du dépôt aphrody (même entrée sous `design/aphrody-m3` ou `m3/`). Les sous-chemins
`./pet`, `./atlas` et `./brand` sont conservés pour les consommateurs existants.

L'atlas du pet vient de `m3/packages/identity/dist/`, copié par `bun run sprite` dans le paquet canonique (à lancer une fois dans un checkout aphrody).
