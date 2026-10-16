# Rendu du pet (WebGPU, Canvas 2D)

Dessine les frames du pet depuis l'atlas `spritesheet.webp`. WebGPU quand la page l'expose, Canvas 2D sinon.

## API

```ts
import { createPetRenderer } from "@aphrody/identity/render";

const renderer = await createPetRenderer(canvas, {
  mode: "2d", // "2d" | "3d"
  backend: "auto", // "auto" | "webgpu" | "canvas2d"
  state: "idle", // piste initiale
});

renderer.start(); // boucle requestAnimationFrame
renderer.play("waving"); // lit une piste (loop par défaut)
renderer.play("jumping", false); // une fois, puis reste sur la dernière frame
renderer.look(dx, dy); // regard vers un point en pixels (écrase la piste)
renderer.setMode("3d"); // bascule 2D/3D sans recréer le rendu
renderer.render(nowMs); // dessin manuel, sans boucle
renderer.stop();
renderer.dispose(); // libère le device GPU et les textures
```

### Options de `createPetRenderer`

| Option     | Défaut         | Rôle                                                           |
| ---------- | -------------- | -------------------------------------------------------------- |
| `mode`     | `"2d"`         | Quad plat ou volume 3D                                         |
| `backend`  | `"auto"`       | `"webgpu"` échoue si absent, au lieu de retomber sur Canvas 2D |
| `state`    | `"idle"`       | Piste de départ                                                |
| `atlasUrl` | atlas embarqué | URL de l'image d'atlas                                         |
| `data`     | `PET`          | Données de pet (pistes, atlas)                                 |
| `depth`    | `0.3`          | Profondeur d'extrusion, fraction de la hauteur de frame (3D)   |
| `slices`   | `24`           | Nombre de tranches du volume (3D)                              |
| `swayDeg`  | `12`           | Amplitude du balancement en degrés (3D)                        |

### Propriétés

- `backend` : `"webgpu"` ou `"canvas2d"`, résolu à la création.
- `state` : piste courante.
- `mode` : mode courant.

## Modes

- **2d** : un quad texturé, prémultiplié, fond transparent.
- **3d** : la frame est répliquée en `slices` tranches le long de l'axe de profondeur, puis tournée autour de l'axe vertical (balancement sinusoïdal). Chaque tranche est éclairée à partir du gradient d'alpha de la silhouette, ce qui donne un volume sans modèle 3D. Le fragment shader rejette les pixels transparents.
- En Canvas 2D, le mode 3D est une approximation : copies décalées horizontalement, assombries vers le fond.

## Modules

- `frames.ts` : logique pure (timeline, UV d'atlas, ajustement de rectangle, balancement, profondeurs de tranches). Testable sans DOM ni GPU.
- `webgpu.ts` : device, pipelines WGSL 2D et 3D, texture depuis `ImageBitmap` (`copyExternalImageToTexture`).
- `canvas2d.ts` : repli `drawImage` avec rectangle source.
- `index.ts` : `createPetRenderer`, chargement de l'atlas, boucle d'animation.

## Tests

`bun test src/render` couvre `frames.ts`. Le rendu WebGPU n'est pas exécuté en test : il exige un navigateur avec WebGPU.
