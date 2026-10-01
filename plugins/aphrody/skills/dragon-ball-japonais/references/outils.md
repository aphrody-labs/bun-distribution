# Chaîne de traitement du japonais (dépôt shenron)

> **S'applique quand :** le monorepo Aphrody est le répertoire de travail (code du site sous `apps/shenron/site`) et Bun est installé. **Sinon :** ne lance aucun script d'ici ; reste sur l'API publique décrite dans `SKILL.md`.

Pour qui travaille sur le code de dragonballfr.com. L'utilisation courante de la
skill ne demande que l'API publique — cf. `SKILL.md`. Documentation de la chaîne :
`docs/shenron/japonais.md` (ses chemins `apps/site/…` datent d'avant le
déplacement sous `apps/shenron/site/…`).

## Installation

```bash
bun apps/shenron/site/scripts/ja-preparer.ts [--force]   # ressources hors dépôt, dans apps/shenron/site/.ja-data/
```

| Ressource                              | Rôle                              | Poids  |
| -------------------------------------- | --------------------------------- | ------ |
| dictionnaire **kuromoji** (IPADIC)     | découpage, nature, lecture, lemme | 18 Mo  |
| index **JMdict** (EDRDG, CC BY-SA 4.0) | « ce mot existe-t-il ? »          | 7,6 Mo |

JMdict est la base de jisho.org (récupérée depuis les publications
`jmdict-simplified`). Seules les formes écrites sont conservées — le JSON
d'origine pèse 113 Mo, d'après `ja-preparer.ts`, pour une question qui tient
dans un ensemble.

## Modules — `apps/shenron/site/src/lib/ja/`

| Fichier            | Contenu                                                  | Pur ?         |
| ------------------ | -------------------------------------------------------- | ------------- |
| `normalisation.ts` | écritures, `normaliserJa`, katakana → hiragana, furigana | oui           |
| `anomalies.ts`     | distance bornée, index du lexique, suggestion            | oui           |
| `traduction.ts`    | protection des termes, segments traduisibles             | oui           |
| `lexique.ts`       | lexique du domaine depuis `bot.*`                        | `server-only` |
| `dictionnaire.ts`  | kuromoji + JMdict, chargement paresseux                  | fichiers      |

Autres modules présents dans ce dossier : `appariement.ts`, `coherence.ts`,
`lexique-canonique.ts`, `index.ts` (non décrits ici ; lis leur en-tête).

## Scripts

```bash
bun apps/shenron/site/scripts/ja-analyser.ts    --json rapport.json   # fautes de lecture
bun apps/shenron/site/scripts/ja-vocabulaire.ts --json vocab.json     # vocabulaire manquant
bun apps/shenron/site/scripts/ja-techniques.ts  [--apply]             # noms japonais des techniques (simulation par défaut)
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

Le détecteur se trompe encore (faux positifs) : rien n'est appliqué
automatiquement, la sortie alimente une relecture humaine. Les chiffres de
performance publiés dans les anciennes versions de cette page ne sont pas
reproduits ici faute de mesure rejouée.

## Pièges vécus

- **`import.meta.dir` est une API Bun** : `undefined` sous Turbopack. Le dossier
  des ressources se résout **à l'appel**, par essais, jamais à l'évaluation du
  module — un build a échoué là-dessus.
- Les ressources (`apps/shenron/site/.ja-data/`) sont gitignorées, donc absentes
  d'une version déployée tant que `ja-preparer.ts` n'y a pas été exécuté : sans
  elles l'analyse peut répondre « 0 anomalie » alors qu'elle en trouve en local.
  Un résultat rassurant et faux est pire qu'une erreur. (Le mécanisme de
  déploiement exact n'est pas documenté dans ce dépôt : à vérifier avant de
  l'affirmer.)
- L'index du lexique doit être construit **avec** le lexique et mis en cache :
  le reconstruire par planche multiplie le coût par le nombre de planches d'un
  ouvrage.
- Le corpus **bouge** : la transcription tourne en continu. Deux mesures
  espacées d'une heure ne portent pas sur le même texte — ne pas attribuer un
  écart à un changement de code sans l'avoir isolé.
