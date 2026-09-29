# Attribution des vignettes d'épisode

Produit par `bun apps/bot/scripts/images-attribution.ts` : chaque vignette est
comparée à l'index image par image de trace.moe, interrogé par bxc. Seul un
vecteur de 33 entiers quitte la machine, jamais l'image.

Vignettes examinées : **8**.

| Verdict | Nombre | Lecture |
|---|---:|---|
| Confirmé | 1 | même épisode, similarité ≥ 0.85 |
| Désaccord | 0 | autre épisode reconnu avec une similarité ≥ 0.85 |
| Accord probable | 5 | même épisode, similarité 0.5–0.85 (vignette ré-encodée) |
| À vérifier | 1 | autre épisode, similarité 0.5–0.85 |
| Sans réponse | 1 | rien au-dessus de 0.5 |

## À vérifier à l'œil

| Fiche | Notre étiquette | Reconnu | Similarité |
|---|---|---|---:|
| 1 | DB 1 | Hayate no Gotoku! 18 | 0.548 |

Rien n'est corrigé automatiquement : remplacer une vignette est une décision
éditoriale, et une similarité moyenne ne suffit pas à la prendre.
