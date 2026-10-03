# Passer en 3D (Blender via MCP)

À lire seulement si la demande porte sur un modèle 3D, une scène, un rendu ou
une impression 3D.

## D'abord : vérifier que Blender est réellement branché

Un serveur MCP Blender expose des outils dont le nom contient `blender`. S'ils
n'apparaissent pas dans les outils disponibles, **le dire franchement et ne pas
improviser** : produire un fichier `.blend` à l'aveugle ou un script Python
qu'on ne peut pas exécuter donne au demandeur l'illusion d'un livrable vérifié.

Ce qui reste faisable sans Blender, et qu'on peut proposer à la place :

- le SVG et ses déclinaisons, qui sont de toute façon le point de départ ;
- un fichier de chemins prêt à extruder (SVG propre, contours fermés, sans
  trait, une couleur par pièce), que le demandeur importera lui-même ;
- une description chiffrée du volume visé (proportions, épaisseurs, arrondis)
  tirée des mesures, qui rendra le travail 3D reproductible plus tard.

L'installation courante s'appelle `blender-mcp` (serveur MCP qui pilote une
instance Blender ouverte via un module complémentaire). C'est au demandeur de
l'installer et de lancer Blender : ces outils agissent sur SA session.

## Le pont naturel : le SVG est déjà le plan

Un dessin construit selon ce skill a exactement la propriété qu'il faut pour la
3D : ses formes sont des **contours fermés** issus d'arcs, pas des traits
d'épaisseur variable. Un contour fermé s'importe dans Blender et s'extrude ;
un trait, non.

Avant d'importer, produire une variante « plan » du SVG :

- une forme fermée par pièce de volume (silhouette, ombre, chaque mèche) ;
- aucun `stroke` — les traits d'encre deviennent soit des pièces à part, soit
  rien du tout ;
- pas de dégradé ni d'opacité, une couleur par pièce, qui servira à retrouver
  les matériaux ;
- des identifiants explicites sur chaque groupe : ils deviennent les noms
  d'objets dans la scène, et c'est ce qui rend la suite pilotable.

## Enchaînement type

1. **Importer** le SVG plan. Il arrive comme courbes, dans le plan XY.
2. **Extruder** chaque courbe de son épaisseur propre. Une masse (un nuage, un
   corps) prend plus d'épaisseur qu'un détail de surface ; les pièces d'ombre
   sont des surcouches très fines, décalées en Z, pas des volumes.
3. **Biseauter** légèrement. C'est le biseau, pas l'extrusion, qui donne
   l'aspect « jouet en vinyle » qu'on associe aux figurines Dragon Ball.
4. **Convertir en maillage** puis fusionner les sommets, sinon les opérations
   suivantes travaillent sur des courbes et les modificateurs se comportent mal.
5. **Matériaux** : un matériau par couleur relevée dans les mesures. Pour un
   rendu fidèle au dessin, un shader plat avec contour (Freestyle ou un
   modificateur solidify inversé en noir) rend mieux qu'un PBR réaliste — le
   dessin de Toriyama est en aplats, un rendu photoréaliste le trahit.
6. **Contrôler par un rendu** et REGARDER l'image, comme pour le SVG. Un modèle
   qu'on n'a pas vu n'est pas un modèle vérifié.

## Ce qui se traduit mal en 3D

Les raccourcis de dessin qui n'ont pas de volume : les volutes plates d'un
nuage, les traits de vitesse, les ombres portées peintes. Les transposer
littéralement donne des reliefs incohérents. Il vaut mieux les traiter comme du
relief de surface (un léger creusement le long du tracé) ou les laisser aux
matériaux, et le dire au demandeur plutôt que de produire un objet bizarre.

Les proportions, elles, se transposent directement : les ratios mesurés sur les
planches restent valables en trois dimensions, c'est justement l'intérêt d'avoir
mesuré avant de dessiner.
