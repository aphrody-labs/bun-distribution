<!-- SPDX-License-Identifier: Apache-2.0 -->
# Parcours Workspace Aphrody

Le [plan racine](../../PLAN.md) définit l’architecture active ; les
[règles du dépôt](../../AGENTS.md) définissent l’exécution. Yolo produit
le runtime et le SDK ; Aphrody conserve les workflows et contrats produit.
Workspace/Infra reste le propriétaire de l’orchestration et de la fabrique.

| Besoin | Référence canonique | Portée |
| --- | --- | --- |
| Préparer un poste développeur | [Bootstrap](bootstrap.md) | Outils et dépendances du dépôt, opérations avec écritures |
| Consommer un runtime précompilé | [Qualification consommateur](runtime-consumer.md) | Provenance, intégration SDK, gates produit et rollback |
| Comprendre la frontière native | [Runtime natif](../../architecture/runtime-native/README.md) | Responsabilités, ABI et renvois vers le plan |
| Éditer et vérifier les docs | [Documentation](documentation.md) | Propriétaire, inventaires et gates sans génération partagée |
| Trouver une commande | [CLI du poste](../../reference/workspace/CLI.md) | Pointeur vers les aides installées, à vérifier au moment d’exécuter |
| Trouver une capacité existante | [Écosystème](../../ecosystem/ECOSYSTEM.md) | Inventaire de navigation, à confirmer dans le propriétaire |

Ces guides décrivent les procédures et renvoient aux autorités ; ils ne
maintiennent pas une deuxième table de statut R0–R8. L’état daté et les limites
de preuve restent dans [PLAN.md](../../PLAN.md) et
[MEMORY.md](../../MEMORY.md). Une entrée d’inventaire, une source présente
ou une commande annoncée ne prouve pas une installation ni une activation.
