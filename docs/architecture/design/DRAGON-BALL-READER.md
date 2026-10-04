<!-- SPDX-License-Identifier: Apache-2.0 -->
# Dragon Ball readers in the M3 family

`@aphrody/m3-reader` owns the manga, databook, and collection reading controls. Its neutral `styles.css` uses M3 color roles. `dragon-ball.css` is an optional reader theme; Shenron imports it and supplies its existing live `--dbz-*` variables. Shenron owns `/admin/design`, the site theme document and validation, asset routing, chapter metadata, OCR review warnings, and transcription text.

| Reader role | Shenron variable | Reader use |
| --- | --- | --- |
| surface, elevated surface, outline | `--dbz-bg`, `--dbz-card`, `--dbz-border` | viewport, controls, separators |
| primary and pressed state | `--dbz-orange`, `--dbz-orange-dark` | active controls and focus |
| on-surface and secondary | `--dbz-blue-light`, `--dbz-blue` | labels and secondary theme color |
| editorial and status accents | `--dbz-yellow`, `--dbz-red` | scrollbar hover and palette slots |
| effects | `--dbz-ember`, `--dbz-ki`, `--dbz-amber` | palette slots for host variants |

The reader theme retains the 12.3° slanted badge, ink borders, tactile button press, dark reading surface, and orange scrollbar from Shenron's prior readers. The original palette and its measurements remain documented in Shenron's `docs/reference/shenron/couverture-analyse-visuelle.md`; no new Toriyama illustration or unmeasured palette is claimed. Reader text uses at least 18 px, keyboard focus is visible, and the databook lightbox traps and restores focus.

The local Shenron dependency currently uses `file:../packages/m3-reader`. Publishing the package and replacing that path with a registry version are still required before an isolated Shenron checkout or deployment can install it. CSS and TypeScript checks do not prove the final browser appearance; inspect the real site after release.
