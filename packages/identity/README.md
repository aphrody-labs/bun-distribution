# @aphrody/identity

The Aphrody product identity for React/M3 surfaces, drawn from `crates/ui/identity` of the aphrody
repository.

| Import | Contents | Needs |
| --- | --- | --- |
| `@aphrody/identity` | `AphrodyAvatar`, `AphrodyPet`, `BRAND_ICONS`, `brandIcon`, `brandSrcSet`, pet data | the `@aphrody/m3` `?url` loader |
| `@aphrody/identity/brand` | brand emblem icons (`icon-64/128/192.png`) as URLs | `?url` loader |
| `@aphrody/identity/atlas` | `PET_ATLAS_URL` (sprite sheet) | `?url` loader |
| `@aphrody/identity/pet` | `PET`, `frameAt`, `gazeFrame`, `spriteStyle` (timed tracks, 16-way gaze) | nothing |

The brand and atlas modules import the crate assets by relative path, so they resolve in an aphrody
checkout (this repository mounted at `m3/`). `src/animations.generated.ts` is generated from the
crate's `assets/aphrody/animations.json` by `bun run gen`; `bun run test` (`src/pet.test.ts`) fails when
the two disagree. Typecheck: `bun run typecheck`.
