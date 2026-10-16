<!-- SPDX-License-Identifier: Apache-2.0 -->
# Qualification d'une frontière native

Critères : [PLAN.md](../../PLAN.md).
Raccordement produit : [guide consommateur](../../guides/workspace/runtime-consumer.md).

| État | Preuve requise |
| --- | --- |
| Source | Révision, chemins, propriétaire, état dirty |
| Build | Commande, cible, profil, toolchain, code de sortie |
| Comportement | Scénarios exécutés, environnement, assertions |
| Artefact | Manifeste, ABI, cible, provenance, hashes |
| Installation | Emplacement, version chargée, intégrité |
| Activation | Parcours produit et retour arrière vérifiés |
| Gain | Avant/après comparables : workload, versions, profil, matériel, méthode |

Chaque état qualifie sa propre portée. Les résultats producteur ne ferment pas
automatiquement les gates consommateur.

Tester les refus ABI/cible/capacités avant appel, erreurs, annulation, buffers,
callbacks tardifs, saturation, arrêt et unload. Conserver les tests produit,
droits et isolation. Vérifier panic/unwind sur l'artefact réel.

Le reçu nomme lot, chemins, baseline, SDK/runtime, commandes et résultats,
checks échoués/non exécutés, limites et rollback. Une preuve citée n'est pas
un check relancé. Aucune valeur secrète, base ou poids de modèle dans le reçu.

Pour la prose : liens, whitespace, intégrité et docs gate. Aucun build moteur.
