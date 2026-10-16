# Codemods — MUI React → `@aphrody/m3-react`

Transforms automatisés pour migrer du code **MUI React** (`@mui/material`) vers les
wrappers **`@aphrody/m3-react`** (web components `<md-*>` du fork material-web).

> Contrat de référence : `../00-CONVENTIONS.md`.
> Tout ce kit respecte §2 (nommage des wrappers), §3 (mapping canonique) et §4
> (règles props/events). **bun uniquement** (§7.1). Aucun élément `md-*` inventé (§7.2).

Deux outils complémentaires :

| Outil                          | Rôle                                                                   | Force                                        |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------- |
| **transforms** (`transforms/`) | réécriture profonde : imports + JSX + props + slots, **variant-aware** | transformation complète, idempotente, testée |
| **ast-grep** (`rules/`)        | détection/rapport des occurrences + quelques fix triviaux              | inventaire rapide, zéro setup Node           |

---

## Installation

Aucune dépendance runtime : le moteur tourne sous Bun seul.

```bash
# ast-grep : pas d'install nécessaire, lancé via bunx @ast-grep/cli (binaire runtime)
```

---

## Transforms

Les transforms partagent le moteur `lib/engine.ts` (table de mapping `lib/mapping.ts`,
helpers JSX `lib/jsx-helpers.ts`). Le source est lu par un scanner TSX (`lib/tsx-scan.ts` :
imports, prologue de directives, arbre JSX), modifié par éditions de texte positionnées
(`lib/edits.ts`) : le code non touché garde sa mise en forme. L'entrée doit être un TSX
valide pour `Bun.Transpiler` (sinon `SyntaxError`, fichier laissé intact).

| Transform                    | Périmètre                                                               | Usage                                                |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| `transforms/orchestrator.ts` | **tout** le mapping (recommandé pour migration de masse)                | `bun scripts/codemod.ts orchestrator 'src/**/*.tsx'` |
| `transforms/mui-imports.ts`  | identique à l'orchestrateur (alias sémantique « imports génériques »)   | `bun scripts/codemod.ts mui-imports <fichiers>`      |
| `transforms/button.ts`       | **dédié** `Button` / `IconButton` / `Fab` (variant-aware)               | `bun scripts/codemod.ts button <fichiers>`           |
| `transforms/fields.ts`       | **dédié** `TextField` / `Select` / `NativeSelect` (+ `MenuItem`)        | `bun scripts/codemod.ts fields <fichiers>`           |
| `transforms/icons.ts`        | **dédié** `@mui/icons-material` → `<md-icon>` (Material Symbols, ~96 %) | `bun scripts/codemod.ts icons <fichiers>`            |

`--dry` liste les fichiers qui changeraient sans les écrire. Chaque transform exporte
`default (file: { path?, source }, api?, options?) => string`.

Le transform `icons.ts` est **séparé** (l'orchestrateur ne touche pas `@mui/icons-material`) : convertit `<CloseIcon/>` → `<md-icon>close</md-icon>` via `lib/icon-names.ts` (PascalCase → snake_case, validé contre les **4253 glyphes** officiels `data/material-symbols-names.json`). Logos de marque (GitHub, X…) gardés + TODO ; voir `../11-material-symbols.md`. Le mapping consolidé (composants + icônes) est exporté en `../mui-m3-map.json` (`bun run scripts/export-map-json.ts`).

Les transforms ciblés (`button`, `fields`) ne touchent **que** leurs composants ; les
autres imports/JSX MUI sont laissés intacts (migration par lots).

### Ce qui est AUTOMATISÉ

- **Imports** (§2/§3) — réécriture `@mui/material` → `@aphrody/m3-react` :
  - imports nommés `import { Button } from '@mui/material'`
  - imports default sous-chemin `import Button from '@mui/material/Button'`
  - **alias** `import { Button as Btn } from '@mui/material'`
  - regroupe les wrappers en un seul `import { ... } from '@aphrody/m3-react'` (trié)
  - ajoute l'import d'effet de bord `@aphrody/material-web/icon/icon.js` si un `<md-icon>` est généré
- **Choix du wrapper variant-aware** (§3) :
  - `Button variant="contained"|absent` → `MdFilledButton`,
    `"outlined"` → `MdOutlinedButton`, `"text"` → `MdTextButton`,
    `"elevated"` → `MdElevatedButton`, `"tonal"` → `MdFilledTonalButton`
  - `TextField variant="filled"|absent` → `MdFilledTextField`, `"outlined"` → `MdOutlinedTextField`
  - `Select` filled/outlined → `MdFilledSelect` / `MdOutlinedSelect`
  - la prop `variant` est **consommée** (retirée) pour ces composants
- **Renommage JSX** des composants 1:1 (§3) : `Checkbox`→`MdCheckbox`, `Switch`→`MdSwitch`,
  `Dialog`→`MdDialog`, `MenuItem`→`MdMenuItem`, `Divider`→`MdDivider`, `Typography`→`MdType`, etc.
- **Icônes** (§4) : `startIcon={<X/>}` / `endIcon={<X/>}` → `<md-icon slot="icon">{<X/>}</md-icon>`
  injecté en premier enfant (+ TODO pour `endIcon`, le slot trailing étant à repositionner).
- **Sous-composants slottés** (§4) : `DialogTitle`/`DialogContent`/`DialogActions`,
  `CardContent`/`CardHeader`/`CardMedia` → `<div slot="headline|content|actions|media">` (+ TODO).
- **Layout** (§3/§6) : `Box`/`Container`/`Stack`/`Grid`/`Paper` → `<div>` (+ TODO Tailwind).
- **Marqueurs `MIGRATION-TODO`** pour tout le non-automatisable, **toujours en JSX valide**
  (`{/* ... */}` entre enfants, commentaire de bloc ailleurs).

### Ce qui reste MANUEL (signalé par `MIGRATION-TODO`)

- **`sx`** — retirée : à convertir en classes Tailwind (host/layout) + tokens `--md-sys-*`.
  Le shadow DOM des `md-*` n'est **pas** atteignable par Tailwind (§6).
- **`onChange(e, value)`** — material-web émet des events natifs `input`/`change` :
  lire `e.target.value` (le 2ᵉ paramètre disparaît, §4). Le corps du handler **n'est pas**
  réécrit automatiquement (risqué) — TODO posé quand une signature à 2 args est détectée.
- **Props sans équivalent** retirées + TODO : `color`, `size`, `fullWidth`,
  `disableElevation`, `disableRipple` (à gérer via tokens/density/thème).
- **Composants « gap »** (§3 / `05-gap-analysis.md`) : `Avatar`, `Alert`, `Breadcrumbs`,
  `Rating`, `Skeleton`, `Backdrop`, `Modal`/`Popover`/`Popper`, `Link`, transitions
  (`Collapse`/`Fade`/…), `CssBaseline`… **NON transformés** : le JSX et **son import MUI
  sont conservés** (pas de référence orpheline), un TODO signale le shim à écrire.
- **Imbrication des slots** Dialog/Card : vérifier que les `<div slot>` sont enfants
  **directs** du parent `md-*`.

### Limites connues

- Le moteur ne réécrit **pas** le corps des handlers ni la logique d'état (controlled).
- Les composants en notation membre (`<Foo.Bar/>`) ne sont pas traités.
- Pas de résolution de re-exports indirects (`import { Button } from './ui'`).
- Le renommage `Tab`→`MdPrimaryTab` ne distingue pas primary/secondary (choix par défaut).
- Les enfants d'un élément renommé sont réimprimés sans les blancs JSX à saut de ligne
  (cosmétique — passer `oxfmt` après coup).
- Un `startIcon`/`endIcon` sur un élément auto-fermant est retiré sans `<md-icon>` (TODO posé).

---

## ast-grep — règles (`rules/` + `sgconfig.yml`)

Complément léger pour **inventorier** ce qui reste à migrer et appliquer des fix triviaux.

```bash
@ast-grep/cli scan                      # rapport sur tout le projet (depuis ce dossier)
@ast-grep/cli scan src/                  # rapport ciblé
@ast-grep/cli scan --filter '^fix-divider$' --update-all   # applique le fix Divider
```

| Règle                   | Type              | Effet                                                                            |
| ----------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `detect-mui-imports`    | rapport (warning) | signale tout `import … from '@mui/material'` (racine **et** sous-chemins)        |
| `detect-gap-components` | rapport (error)   | signale les composants « gap » sans équivalent md (migration manuelle)           |
| `detect-sx-prop`        | rapport (warning) | signale les props `sx` à convertir (Tailwind + tokens)                           |
| `fix-divider`           | **fixable**       | `<Divider …/>` → `<md-divider …>` (mapping 1:1 trivial ; l'import reste à gérer) |

> ast-grep ne fait **pas** le choix variant-aware ni la gestion d'imports propre :
> pour une vraie migration, utiliser les transforms. Les règles servent surtout au **rapport**.

---

## Tests / vérification

Fixtures avant/après dans `__testfixtures__/` (préfixe `icons-` → transform `icons`,
sinon orchestrateur ; découverte automatique) :

```bash
bun test ./test                            # sortie TSX valide, idempotence, égalité oxfmt avec *.output.tsx
bun run scripts/run-fixtures.ts            # même comparaison, en PASS/FAIL
bun run scripts/run-fixtures.ts --update   # régénère les attendus (après modif volontaire d'un transform)
```

Les sorties sont comparées après `oxfmt` des deux côtés (binaire `oxfmt` requis dans le PATH).
Les attendus viennent du moteur jscodeshift/recast d'origine (capture avant migration) ;
seule exception, `jsx-strings.output.tsx` garde l'espace significatif que recast perdait.

### État vérifié (dernière exécution)

- `bun test ./test` → 11 fixtures + scanner + rejet TSX invalide, 0 échec.
- `tsgo --noEmit -p tsconfig.json` → 0 erreur.
- `ast-grep scan` sur fichier d'épreuve → 4 règles déclenchées (2 imports, 1 gap, 1 sx, 2 divider).

---

## Arborescence

```
codemods/
├── README.md                      ← ce fichier
├── package.json
├── sgconfig.yml                   ← config ast-grep
├── lib/
│   ├── mapping.ts                 ← table MUI→wrappers (source : 00-CONVENTIONS.md §3/§4)
│   ├── tsx-scan.ts                ← scanner TSX (imports, directives, arbre JSX)
│   ├── edits.ts                   ← éditions de texte positionnées + validation Bun.Transpiler
│   ├── imports.ts                 ← filtrage/insertion d'imports
│   ├── jsx-helpers.ts             ← utilitaires JSX (slots, TODO, props)
│   └── engine.ts                  ← moteur partagé (imports + JSX + props)
├── transforms/
│   ├── orchestrator.ts            ← tout-en-un (recommandé)
│   ├── mui-imports.ts             ← imports génériques (= orchestrateur)
│   ├── button.ts                  ← dédié Button/IconButton/Fab (variant-aware)
│   ├── fields.ts                  ← dédié TextField/Select/NativeSelect
│   └── icons.ts                   ← dédié @mui/icons-material → <md-icon>
├── rules/
│   ├── detect-mui-imports.yml
│   ├── detect-gap-components.yml
│   ├── detect-sx-prop.yml
│   └── fix-divider.yml
├── scripts/
│   ├── codemod.ts                 ← CLI d'application des transforms
│   ├── fixtures.ts                ← découverte + exécution des fixtures
│   └── run-fixtures.ts            ← test rapide avant/après
├── test/fixtures.test.ts
└── __testfixtures__/              ← *.input.tsx / *.output.tsx
```
