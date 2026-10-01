# Animer un SVG Dragon Ball

À lire quand la demande porte sur du mouvement : Kaméhaméha, charge de ki,
téléportation, aura de transformation, nuage qui file, boules qui orbitent.

Le principe qui gouverne tout le reste : **une technique Dragon Ball se lit en
phases**, et c'est le découpage en phases qui rend l'animation crédible, pas la
finesse du dessin. Un Kaméhaméha n'est pas « un rayon bleu » : c'est une charge,
une détente, un faisceau tenu, une dissipation. Chaque phase a sa durée, sa
courbe d'accélération et son registre sonore visuel.

## Le découpage d'un Kaméhaméha

| Phase       | Durée indicative | Ce qui bouge                                                                                                                           |
| ----------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Charge      | 40 % du cycle    | Une sphère grossit entre les paumes, pulse, aspire des particules vers elle. Aura qui monte, jamais qui descend.                       |
| Détente     | 5 %              | Compression brève de la sphère, flash blanc. C'est l'image d'anticipation : sans elle, le tir « sort de nulle part ».                  |
| Faisceau    | 45 %             | Un cylindre qui s'allonge vite puis se tient. Noyau blanc, gaine cyan, halo diffus. Des anneaux de choc remontent le long du faisceau. |
| Dissipation | 10 %             | Le faisceau s'amincit et se dissout par la base, les anneaux se dispersent.                                                            |

Les proportions comptent plus que les valeurs absolues : un cycle de 2,4 s ou de
6 s marche, tant que la charge domine et que la détente est presque instantanée.

## Choisir SMIL ou CSS

- **CSS** (`@keyframes` + `<style>` dans le SVG) pour tout ce qui est
  transformation et opacité : c'est composité par le GPU, ça survit à
  l'inlining dans du JSX, et ça se coupe proprement en mouvement réduit.
- **SMIL** (`<animate>`, `<animateMotion>`) quand il faut animer un attribut que
  CSS n'atteint pas — `d` d'un chemin, `offset` d'un dégradé, `stroke-dasharray`
  sur un tracé complexe. Bien supporté aujourd'hui, y compris Safari.
- **Jamais de JavaScript** pour une animation décorative : le SVG doit rester
  affichable en `<img>` et en composant serveur.

## Motifs utiles

**Faisceau qui s'allonge** — animer `scale` sur l'axe du tir plutôt que la
géométrie, avec `transform-origin` à la source :

```xml
<g style="transform-origin:180px 300px;animation:kb-tir 2.4s cubic-bezier(.16,1,.3,1) infinite">
```

**Anneaux de choc** — un seul anneau dupliqué avec des `animation-delay`
négatifs échelonnés donne l'illusion d'un flux continu à moindre coût.

**Pulsation de charge** — deux animations superposées de périodes non multiples
(par exemple 0,8 s et 1,3 s) : la somme ne se répète pas à l'œil, l'énergie
paraît instable au lieu de battre la mesure.

**Aura** — un contour flou (`filter: blur`) qui monte, avec des mèches
d'énergie tracées comme des mèches de cheveux (voir `meche()` dans
`plugins/aphrody/skills/toriyama-svg/scripts/geometrie.ts`). L'aura de Toriyama est faite de pointes, pas d'un halo
radial lisse.

**Particules aspirées** — `<animateMotion>` sur un chemin qui converge vers la
sphère, avec `keyPoints` non linéaire pour accélérer près du centre.

## Mouvement réduit

Toujours terminer par :

```css
@media (prefers-reduced-motion: reduce) {
	* {
		animation: none !important;
	}
}
```

Et vérifier que le dessin figé reste lisible : si l'état de repos est une sphère
invisible, l'animation portait tout le sens et il faut redessiner l'état
statique. Un utilisateur qui coupe les animations doit voir un Kaméhaméha, pas
un personnage les mains vides.

## Contrôler une animation sans navigateur

Rendre trois ou quatre instants du cycle en PNG et les monter côte à côte : on
voit immédiatement si la phase de détente existe, si le faisceau part bien de la
paume, si l'aura déborde. Avec `sharp`, il suffit de générer une variante du SVG
par instant (les animations remplacées par les valeurs figées correspondantes).
C'est moins élégant qu'un navigateur, mais c'est reproductible et ça tient dans
un script.

Si un navigateur est disponible via MCP, l'ouvrir et capturer à intervalles
donne un contrôle plus fidèle — notamment sur les filtres et les dégradés animés.
