# Chaîne de traitement du japonais (dépôt shenron)

Pour qui travaille sur le code de dragonballfr.com. L'utilisation courante de la
skill ne demande que l'API publique — cf. `SKILL.md`.

## Installation

```bash
bun apps/site/scripts/ja-preparer.ts        # ~25 Mo, hors dépôt
```

| Ressource                              | Rôle                              | Poids  |
| -------------------------------------- | --------------------------------- | ------ |
| dictionnaire **kuromoji** (IPADIC)     | découpage, nature, lecture, lemme | 18 Mo  |
| index **JMdict** (EDRDG, CC BY-SA 4.0) | « ce mot existe-t-il ? »          | 7,6 Mo |

JMdict est la base de jisho.org : 218 461 entrées, 464 819 graphies. Seules les
formes écrites sont conservées — le JSON d'origine pèse 113 Mo pour une question
qui tient dans un ensemble.

## Modules — `apps/site/src/lib/ja/`

| Fichier            | Contenu                                                  | Pur ?         |
| ------------------ | -------------------------------------------------------- | ------------- |
| `normalisation.ts` | écritures, `normaliserJa`, katakana → hiragana, furigana | oui           |
| `anomalies.ts`     | distance bornée, index du lexique, suggestion            | oui           |
| `traduction.ts`    | protection des termes, segments traduisibles             | oui           |
| `lexique.ts`       | lexique du domaine depuis `bot.*`                        | `server-only` |
| `dictionnaire.ts`  | kuromoji + JMdict, chargement paresseux                  | fichiers      |

## Scripts

```bash
bun apps/site/scripts/ja-analyser.ts    --json rapport.json   # fautes de lecture
bun apps/site/scripts/ja-vocabulaire.ts --json vocab.json     # vocabulaire manquant
bun apps/site/scripts/ja-techniques.ts  [--apply]             # noms japonais des techniques
```

Les deux premiers lisent **le même signal en sens inverse** : une graphie
inconnue partout est une faute si elle est **rare** et ressemble à un terme
connu, du vocabulaire manquant si elle est **fréquente** et ne ressemble à rien.

## Détection des fautes — les quatre filtres

Une graphie n'est signalée que si tous la laissent passer :

1. kuromoji la marque inconnue d'IPADIC ;
2. **JMdict** ne la connaît pas non plus — absout les emprunts à l'anglais
   (`コミックス`, `バーサス`, `スライム`), corrects mais absents des dictionnaires
   morphologiques ;
3. elle n'est ni un terme du domaine, ni un **morceau** d'un terme du domaine —
   IPADIC découpe les noms qu'il ignore, et `ンクス` (bout de `トランクス`)
   remontait 105 fois ;
4. la forme correcte existe dans le corpus **et y domine**.

Mesuré : ~2 M de tokens en 57 s, ~1 220 corrections proposées, **environ 15 %
de faux positifs**. Rien n'est appliqué automatiquement.

## Pièges vécus

- **`import.meta.dir` est une API Bun** : `undefined` sous Turbopack. Le dossier
  des ressources se résout **à l'appel**, par essais, jamais à l'évaluation du
  module — un build a échoué là-dessus.
- Les ressources sont gitignorées, donc absentes des versions figées du
  déploiement bleu/vert. `deploy-site.ts` pose un lien symbolique ; sans lui,
  l'analyse répond « 0 anomalie » en production alors qu'elle en trouve 1 217 en
  local. Un résultat rassurant et faux est pire qu'une erreur.
- L'index du lexique doit être construit **avec** le lexique et mis en cache :
  le reconstruire par planche revient à le refaire 362 fois pour un ouvrage.
- Le corpus **bouge** : la transcription tourne en continu. Deux mesures
  espacées d'une heure ne portent pas sur le même texte — ne pas attribuer un
  écart à un changement de code sans l'avoir isolé.
