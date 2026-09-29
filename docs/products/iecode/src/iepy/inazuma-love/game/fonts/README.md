# Polices

| Fichier | Origine | Licence |
|---|---|---|
| `Geist-Regular.ttf`, `Geist-Bold.ttf` | vercel/geist-font | SIL Open Font License 1.1 — voir `LICENSE-Geist.txt` |
| `SourceHanSansLite.ttf` | distribuée avec le SDK Ren'Py | SIL Open Font License 1.1 |
| `Lucide.ttf` | [lucide-static](https://lucide.dev) 1.38.0 | ISC — voir `LICENSE-Lucide.txt` |

`theme.rpy` les assemble en un `FontGroup` unique, `POLICE_UI`, que `gui.rpy`
installe comme police de tout le jeu. Une même chaîne peut donc mêler les trois
écritures sans balise `{font=…}` :

| Plage | Police | Pourquoi |
|---|---|---|
| `U+E000`–`U+F8FF` | Lucide | zone à usage privé — les icônes d'interface |
| `U+0020`–`U+04FF` | Geist | latin, accents, `«` `»` |
| `U+2000`–`U+20FF` | Geist | tirets cadratins, guillemets typographiques, devises |
| tout le reste | Source Han Sans | japonais, kana, ponctuation CJK |

L'ordre compte : `FontGroup.add` donne la priorité au **premier** appel qui
couvre un caractère.

## Icônes

`fonts/lucide-icones.json` associe un nom Lucide à son point de code, pour les
seules icônes employées par l'interface. Côté écran :

```renpy
textbutton avec_icone("book-open", L("menu_encyclopedie")) action …
text icone("triangle-alert") + " [probleme]"
```

`icone()` rend `""` quand la table ne connaît pas le nom — une icône manquante
n'empêche jamais d'ouvrir un menu, même règle que pour les médias.

**Les points de code de Lucide ne sont pas stables d'une version à l'autre**
([lucide#514](https://github.com/lucide-icons/lucide/issues/514)). `Lucide.ttf`
et `lucide-icones.json` forment une paire : remplacer l'un sans régénérer
l'autre décale toutes les icônes. La table se régénère depuis le `font/info.json`
du paquet `lucide-static` de la même version.

## Pourquoi un groupe et pas une seule police

Aucune des trois ne suffit seule, mesures faites sur les fichiers livrés :

* Geist expose 728 glyphes — pas un seul idéogramme. Avec Geist seule, la locale
  `ja` et les noms japonais du casting (円堂 守, 矢嶋 陽介…) s'affichaient
  intégralement en carrés.
* `SourceHanSansLite.ttf` est un sous-ensemble : 122 trous rien que dans
  Latin-1, et aucun caractère de Latin étendu A. Elle ne peut pas porter
  l'interface française seule.
* Ni l'une ni l'autre n'a `★` `☆` `⚠` `✓`. Ces caractères étaient écrits en dur
  dans les écrans et s'affichaient en carrés : ils sont désormais des icônes
  Lucide.
