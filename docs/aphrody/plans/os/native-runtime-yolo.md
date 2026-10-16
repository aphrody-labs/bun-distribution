<!-- SPDX-License-Identifier: Apache-2.0 -->
# Qualification du runtime Aphrody installé

Architecture et workflow : [PLAN racine](../../PLAN.md).
Portée : cohérence source/artefact/processus chargé, CLI et MCP sur ce poste.
Ne pas confondre runtime produit Aphrody et producteur Yolo.

## Oracle

- Bun docs : CLI sans override et MCP live retournent la référence child-process,
  avec résultat réel et sans erreur.
- Web natif : outils uniques, appel représentatif live réussi via owner existant.
- Processus : hash binaire installé égal au binaire effectivement chargé.
- Gates ciblés : checks/tests/Clippy, release, format/diff avec exit codes réels.
- Installation et rollback vérifiés ; portée hôte explicitement annoncée.

## Exécution

Reproduire un défaut → sélectionner owner/chemins → correction → gates
sérialisés → installation autorisée via owner → répéter l'appel original →
reçu et livraison. Préserver les services/builds concurrents, caches et stores.
Aucun nouveau client, clone, copie de travail ou équipe d'agents automatique.

Les anciens PID, comptes de tools et diagnostics étaient un checkpoint daté,
pas l'état actuel. Recontrôler les processus sélectionnés à l'exécution.
Identité et commandes : [AGENTS.md](../../AGENTS.md).
