<!-- SPDX-License-Identifier: Apache-2.0 -->
# Qualification d’une frontière native

Cette grille complète la [navigation runtime](README.md) pour lire un reçu.
Les gates R0–R8 et les décisions de promotion restent dans le
[plan directeur](../../../PLAN.md), section 14. La procédure applicative est
le [guide consommateur](../../guides/workspace/runtime-consumer.md).

| État annoncé | Preuve à joindre | Limite |
| --- | --- | --- |
| Source présente | Révision, chemins, état dirty et propriétaire | Aucun build ou comportement démontré |
| Build passé | Commande, cible, profil, toolchain, code de sortie | Aucune parité fonctionnelle implicite |
| Comportement démontré | Scénario, environnement, assertions et résultat réel | Portée limitée aux scénarios exécutés |
| Artefact packagé | Manifeste, ABI, cible, provenance et hashes | Packaging distinct de l’installation |
| Installé | Emplacement, version chargée et vérification d’intégrité | Installation distincte de l’activation produit |
| Activé | Parcours consommateur réel et retour arrière vérifié | Aucune généralisation aux autres produits ou cibles |
| Gain mesuré | Avant/après comparables, méthode, versions, matériel et workload | Suppression de lignes ou dépendances seule insuffisante |

## Refus et arrêt à qualifier

Le consommateur doit refuser ABI, cible ou capacités incompatibles avant
l’appel natif. Les scénarios pertinents couvrent erreur structurée, annulation,
libération par l’allocateur propriétaire, callbacks tardifs, saturation et
arrêt des travaux avant unload. Les contrats produit existants, l’isolation de
session et les refus de droits gardent leurs propres tests.

Le profil panic/unwind se vérifie à la frontière de l’artefact. Une analyse
lexicale ou une dérogation par package ne prouve pas le profil d’un exécutable
unifié. Ne pas retirer l’ancien backend ou la dépendance lourde tant que la
parité requise, le graphe consommateur et le rollback ne sont pas qualifiés.

## Reçu consommateur

Associer chaque résultat à un lot possédé : chemins, révision de départ,
provenance SDK/runtime, commandes réellement exécutées et leurs codes de sortie,
contrats vérifiés, gates non exécutés ou échoués, limites et retour arrière.
Séparer une preuve producteur citée d’une vérification relancée localement.
Les chemins de stores protégés restent des références ; aucune valeur secrète,
base de données ou poids de modèle n’est copié dans le reçu.

Un worker documentaire valide prose, liens et intégrité des archives. Les
builds Cargo appartiennent à l’intégrateur via la fabrique sérialisée ; leur
absence ne doit pas être transformée en réussite de compilation.
