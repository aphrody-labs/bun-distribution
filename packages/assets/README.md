# @aphrody/assets

File-kind icons, extension badges, brand logos, images, sounds, videos and Lottie animations for the
M3 explorer surfaces, with icon resolution helpers. The set merges the Spacedrive `@sd/assets`
(FSL-1.1-ALv2, `LICENSE.spacedrive`, upstream notes in `UPSTREAM-README.md`) with SpaceUI's
`@spacedrive/icons` (MIT, `LICENSE.spaceui`, `UPSTREAM-CHANGELOG.spaceui.md`).

| Import                                           | Contents                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `@aphrody/assets/icons`                          | raster file-kind icons (`*.png`, `*-20.png`, `*_Light.png`) as URLs                       |
| `@aphrody/assets/images`                         | product images                                                                            |
| `@aphrody/assets/svgs/*`                         | SVG sources; `svgs/ext/` holds the extension badges (`ext/icons.json`, `ext/Extras/urls`) |
| `@aphrody/assets/sounds`, `videos/*`, `lottie/*` | media                                                                                     |
| `@aphrody/assets/util`                           | `getIcon`, `getLayeredIcon`, `getBeardedIcon`, `getIcon20`                                |
| `@aphrody/assets/util/mobile`                    | the same without `beardedIconUrls` (React Native)                                         |

`bun run gen` regenerates the per-folder `index.ts` barrels (`scripts/generate.ts`, oxfmt formatted).
`bun run test` checks the generated barrels against the folders; `bun run typecheck` runs `tsc`.
