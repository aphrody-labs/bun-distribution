# aphrody-identity

Identité produit d'Aphrody : logo et icônes de marque, palette mesurée et jetons M3, pet animé
(atlas RGBA, pistes minutées, regard sur 16 directions) et outils de mesure d'image (`pixel`).
Licence Apache-2.0 ; dérivations et sources dans [`NOTICE`](NOTICE).

| Module | Rôle |
| --- | --- |
| `pets` | Contrat pet de Codex : manifeste `pet.json`, pistes par défaut, frame courante, état ambiant à durée de vie, regard |
| `codex` | Conformité v1/v2, validations reproduites du TUI Codex et de l'installeur de la galerie, artefacts et installation |
| `web` | Données de `<aphrody-pet>` (`assets/aphrody/web.json`) et suite de parité Rust ↔ web |
| `logo`, `assets`, `design` | Logo, favicon, manifeste web, jetons et CSS de marque |
| `pixel` | Décodage, rastérisation SVG, comparaison et planches de sprites |

## Pet

Une seule horloge, celle de `pets.rs` : la frame se choisit par accumulation de durées
(millisecondes entières), `loopStart` rejoue le seul segment de boucle, une passe unique se fige
puis cède une fois la main à son `fallback`, un nom inconnu joue `idle`. Les états `running`,
`waiting`, `review`, `failed` durent 3 min, 24 h, 7 j et 1 h, comme dans Codex.

Les pistes d'Aphrody sont composées selon la règle de Codex (séquence d'état jouée trois fois puis
repos en boucle, alias `move_right`, `wave`, `sad`…) ; un test vérifie qu'elles égalent les pistes
par défaut de Codex.

## Pet web : `<aphrody-pet>`

Choix : **option B**, un port TypeScript de l'horloge (`m3/packages/identity/src/runtime.ts`)
alimenté par `assets/aphrody/web.json`, que la crate génère (pistes, états, ligne de regard, CSS
des 88 cellules produite par `aphrody-sprite-sheet`). Mesures du 2026-10-09 (Bun 1.4.3, Windows,
`bun run measure` dans `m3/packages/identity`) :

| | Brut | gzip | brotli | Chargement | Tick |
| --- | --- | --- | --- | --- | --- |
| B — `<aphrody-pet>` complet (`bun build --minify`) | 16,6 Ko | 3,6 Ko | 3,0 Ko | import 1,4 ms | 180 ns |
| B — horloge + données seules | 12,9 Ko | 2,2 Ko | 1,7 Ko | import 1,2 ms | — |
| A — horloge de la crate en wasm32 (`examples/pet_wasm.rs`, LTO, `opt-level=z`, `wasm-opt -Oz`) | 203,7 Ko | 59,1 Ko | 46,9 Ko | instanciation 0,5 ms | 226 ns |

Les deux options rendent les 966 ticks de la fixture sans écart ; l'option A pèse 16 fois plus
compressée (désérialisation serde du manifeste embarqué), sans compter l'élément lui-même, qu'il
faut écrire en JS dans les deux cas. La parité de B est tenue par
`tests/fixtures/parite-web.json` : la crate l'écrit (`tests/parite_web.rs`), `src/runtime.test.ts`
la rejoue tick pour tick (frontières de frames ±1 ms, temps pseudo-aléatoires jusqu'à 10⁷ ms,
scénario d'ambiance, rose de 192 points pour le regard). Après un changement de pistes :
`APHRODY_IDENTITY_BLESS=1 cargo test -p aphrody-identity --test parite_web`, puis `bun run gen`.

L'élément : réveil par `setTimeout` au délai de la frame (jamais à cadence fixe),
`prefers-reduced-motion` fige la première frame, API `setState` / `clearState` / `play`, attributs
`src`, `size`, `state`, `animation`, `label`, `no-gaze`, regard qui suit le pointeur au repos.
Démo : `bun run demo` (`Bun.serve`, route HTML groupée par Bun) ; `bun demo/check.ts` la pilote
dans Chrome headless (horloge, états, mouvement réduit, regard, capture).

## Pet dans Codex

Spécification vérifiée le 2026-10-09 sur `openai/codex` `main` (`c63929af5051`) : `model.rs` et
`catalog.rs` inchangés depuis le 2026-08-17. Le TUI n'accepte qu'un atlas de 1536 × 1872 (v1) ;
la v2 (1536 × 2288, 16 directions) n'est lue que par l'app.

```sh
aphrody identity pet codex                 # artefact v1 dans $CODEX_HOME/pets/aphrody (défaut ~/.codex)
aphrody identity pet codex --v2            # atlas complet, pour l'app Codex
aphrody identity pet codex --sortie DIR    # écrit pet.json + spritesheet.webp sans installer
aphrody identity pet verifier ~/.codex/pets/aphrody
```

Puis `[tui] pet = "aphrody"` dans `config.toml`, ou `/pets`. L'artefact v1 reprend les neuf
premières lignes de l'atlas (WebP sans perte) et laisse Codex appliquer ses pistes par défaut.
L'installation rejoue sur les fichiers écrits les contrôles du TUI et de l'installeur de la
galerie ; `tests/codex_conformite.rs` couvre les refus (grille incomplète, chemin sortant, frames
vides ou hors grille, fps hors de ]0, 60], repli inexistant, atlas non WebP ou mal dimensionné,
fichier non géré dans le dossier cible).

## Tests

```sh
bun scripts/build/rust/cargo-serial.ts --msvc test -p aphrody-identity   # Windows natif, depuis la racine
cd m3/packages/identity && bun test src && bun run typecheck
```
