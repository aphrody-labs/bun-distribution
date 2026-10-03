<!-- SPDX-License-Identifier: Apache-2.0 -->
# Fork Next.js — plan propriétaire

Relevé source : 2026-10-03. Yolo possède le fork/import et les moteurs ;
Aphrody possède les applications Next concernées.
Architecture et workflow : [PLAN racine](../../../../PLAN.md).
Import/fork : [Yolo VENDORING](../../../../../yolo/docs/VENDORING.md).

## État vérifié

Checkout existant : `../yolo/vendor/next`, branche `yolo`.
Pins source : vendor manifest/lock Yolo. Scaffold : `templates/stack.toml`
et `apps/cli/src/create.ts` côté Yolo. Le parser actuel accepte les variantes
framework Hono/Elysia ; Next reste une proposition, pas un flag livré.

L'ancien document était une seule ligne avec 230 séquences newline échappées.
Ses tableaux « supporté/opérationnel », versions exemples et affirmation d'une
réécriture intégrale de Bun en Rust n'étaient pas accompagnés de reçus.
Ils ne qualifient pas une compatibilité actuelle.

## Queue

| Travail | Gate |
| --- | --- |
| Synchronisation du fork | Owner workflow, ref amont choisie, aucun force-push ni perte de patches |
| P-NEXT-01 : standalone/tracing | SDK/runtime inclus par provenance ; pas Node externe implicite |
| P-NEXT-02 : accès runtime | ABI/capacités négociées pour server components et API routes |
| P-NEXT-03 : IPC workers | fork/send/descriptors, concurrent cache et workers sous superviseur |
| P-NEXT-04 : arrêt | SIGTERM/SIGINT, fin bornée, aucun worker possédé restant |
| Template Next proposé | CLI create, deps épinglées, TS config, layout/page/health et build-standalone |
| Release consommateur | Installation/runtime vérifiés et rollback avec même contrat produit |

Qualifier Pages/App Router, RSC/streaming, server actions/cookies,
dynamic/lazy chunks, Turbopack dev/build et standalone séparément.
Le banc Next dans le fork Bun est une entrée à vérifier contre le pin sélectionné,
pas un test déclaré vert ici. Aucun bénéfice SWC/Turbopack déduit de leur langage.

## Livraison

Modifier les owners existants, réutiliser le checkout et les caches.
Aucun clone de vérification, copie de template concurrente ou chaîne de build
alternative. Builds moteurs via fabrique ; tests applicatifs par leurs owners.
Garder les patches et notices jusqu'à remplacement qualifié.
