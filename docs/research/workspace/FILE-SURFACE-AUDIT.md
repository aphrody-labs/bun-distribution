<!-- SPDX-License-Identifier: Apache-2.0 -->
# Note de recherche — audit Files/VFS

**2026-10-02 — référence canonique :** [audit Files, VFS et recherche](../../operations/workspace/HISTORY.md).
Ce fichier remplace le miroir complet conservé ici jusque-là. Le relevé du
2026-09-28 reste historique; ses chemins de checkouts ne sont pas un inventaire
actuel des consommateurs.

## Vérification IECODE ajoutée à l'audit canonique

Le VFS Python IEVR appartient au workspace IECODE sous `src/niepy`. Les
règles et le plan IECODE
déclarent ce propriétaire unique. Le chemin Ren'Py de copie
`src/iepy/inazuma-love/game/libs/nie/python-packages/niepy/` cité par le
précédent miroir est absent du checkout au contrôle du 2026-10-02. Le nombre de
copies de ce relevé antérieur n'est donc plus présenté comme un état courant.
La provenance de migration reste dans le
manifeste IECODE.

Cette vérification de chemins n'exclut pas d'autres consommateurs dynamiques.
Le contenu de la matrice de doublons et les autres limites sont maintenus dans
l'audit canonique; ne pas utiliser cette note comme preuve de parité installée.
