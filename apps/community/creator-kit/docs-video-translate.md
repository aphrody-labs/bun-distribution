<!-- SPDX-License-Identifier: Apache-2.0 -->

## video-translate

Traduit une vidéo (jeux de combat, dessin, anime) en **sous-titres anglais naturels**, pas une traduction mot à mot.
Tout est local par défaut : un moteur de reconnaissance vocale local, un modèle de langage local, `ffmpeg`. Rien n'est
envoyé ailleurs que vers l'endpoint que tu configures toi-même (voir [Confidentialité](#confidentialité)).

```bash
# une vidéo locale (ASR + traduction), sortie à côté : match.en.srt
creator-kit video-translate match.mp4 --from ja

# des sous-titres japonais déjà prêts (pas d'ASR)
creator-kit video-translate --subs-from match.ja.srt

# un lien, avec les sous-titres incrustés dans la vidéo
creator-kit video-translate "https://…" --burn --bilingual

# voir ce qui serait fait, sans rien lancer
creator-kit video-translate match.mp4 --dry-run
```

### Pourquoi la traduction n'est pas littérale

Une traduction ligne à ligne produit « took the down », « going to explode here », « Pochomkin », « Romacan »
(voir [les mesures](#qualité-mesurée)). Le programme combine six mécanismes, tous dans `src/commands/video-translate/` :

1. **Consigne de traducteur FGC** (`prompts.ts`) : sens et intention avant les mots, ton du locuteur (casual, hype,
   trash talk), pas de sur-traduction des honorifiques, pronoms déduits du contexte, mots de remplissage supprimés,
   blagues rendues par leur effet, budget de caractères par cue (`max_chars` selon la durée à l'écran), six exemples de
   calibrage « littéral → naturel ».
2. **Contexte glissant** : résumé global du média (première passe), puis fenêtres de 20 cues avec les 5 dernières cues
   déjà traduites et les 3 prochaines cues sources en lecture seule. Réglable : `--window`, `--context-before`,
   `--context-after`.
3. **Sortie JSON stricte** : un tableau `[{"id","text"}]` avec exactement les mêmes ids dans le même ordre. Réponse
   invalide → invite de réparation qui nomme le problème (`--retries`, 2 par défaut) → repli cue par cue → en dernier
   recours la cue garde son texte source et elle est signalée. `""` est permis pour une cue absorbée par la phrase
   de la cue précédente.
4. **Glossaires** (voir plus bas) : seules les entrées présentes dans la fenêtre sont injectées ; après la réponse, un
   rendu littéral interdit (« rampage » pour 暴れ, « fraud jump » pour 詐欺飛び…) déclenche une réécriture ciblée, et un
   rapport de cohérence liste les termes rendus de façons différentes.
5. **Contraintes de sous-titrage** (`layout.ts`) : 2 lignes de 42 caractères au plus, 17 caractères/seconde au plus.
   Allongement dans le silence, fusion des fragments trop courts, découpe des cues trop longues proportionnellement au
   temps d'origine, jamais de chevauchement. Ce qui reste illisible est compté dans le bilan.
6. **Relecture optionnelle** (`--review`) : une seconde passe signale les contresens sans tout réécrire (voir les
   [limites](#limites-à-connaître)).

Température basse (0,2) et graine fixe (7, `--seed`) ; la graine est retirée toute seule si le serveur la refuse.

### Prérequis

| Outil                            | Rôle                                            | Obligatoire                                  |
| :------------------------------- | :---------------------------------------------- | :------------------------------------------- |
| `ffmpeg` + `ffprobe`             | extraction audio 16 kHz mono, incrustation, mux | oui pour un fichier média, `--burn`, `--mux` |
| un moteur ASR (ci-dessous)       | transcription                                   | non avec `--subs-from`                       |
| un serveur LLM compatible OpenAI | traduction                                      | oui                                          |
| `yt-dlp`                         | téléchargement d'un lien                        | seulement pour un lien                       |

**Reconnaissance vocale.** Ordre de détection (le moteur utilisé est affiché au lancement et dans `--dry-run`) :

1. `whisper-cli` (whisper.cpp) avec un modèle ggml : `--whisper-model <fichier.bin>`, ou la variable `WHISPER_MODEL`,
   ou un `ggml-*.bin` dans `~/.cache/whisper`, `~/.local/share/whisper`, `~/whisper.cpp/models`. Installation d'après le
   README de whisper.cpp : `git clone https://github.com/ggml-org/whisper.cpp`, `cmake -B build`,
   `cmake --build build -j --config Release`, `sh ./models/download-ggml-model.sh large-v3-turbo`. Appel fait par l'outil :
   `whisper-cli -m <modèle> -f <chunk.wav> -l <langue|auto> -osrt -of <préfixe>` (options en plus : `--whisper-args "<…>"`).
2. `faster-whisper` via `uv`, script inline (métadonnées PEP 723) que l'outil écrit lui-même :
   `uv run --script fw_transcribe.py <langue|auto> <modèle> <device> <compute> <chunk.wav>`
   (`--fw-model large-v3`, `--fw-device auto`, `--fw-compute default`). `uv` installe `faster-whisper` au premier
   lancement et le modèle est téléchargé depuis Hugging Face à ce moment-là (c'est le seul accès réseau du moteur). Le
   script active `word_timestamps`, `vad_filter` et coupe `condition_on_previous_text` (moins de boucles d'hallucination).
3. un endpoint OpenAI `POST /v1/audio/transcriptions` : `--asr-url http://hôte:port` (+ `--asr-model whisper-1`,
   `--asr-key-env VAR`). Si `--asr-url` est donné, il passe en premier. `--asr whisper-cli|faster-whisper|endpoint` force un moteur.

Les longs fichiers sont découpés en tronçons de 600 s qui se recouvrent de 5 s (`--chunk-seconds`, `--overlap-seconds`) ;
chaque segment est attribué au tronçon dont il est au centre, les doublons de recouvrement, les boucles d'hallucination
(≥ 3 répétitions), les `♪` et `(拍手)` sont éliminés, et les segments trop longs sont coupés au plus grand silence entre
mots quand les horodatages de mots existent (faster-whisper, endpoint).

**Modèle de traduction.** Par défaut l'outil teste `http://127.0.0.1:8795/v1` (passerelle aphrody : `aphrody gateway
serve`, `aphrody gateway models`) puis `http://127.0.0.1:8080/v1` (`llama-server -m <modèle.gguf> --port 8080`), ou
`CREATOR_KIT_LLM_URL`. Le modèle est `--llm-model`, `CREATOR_KIT_LLM_MODEL`, ou le premier modèle chargé listé par
`/models`. La clé API se passe par variable d'environnement (`--llm-key-env VAR`), jamais en argument. `--llm-extra
'{"…":…}'` ajoute des champs au corps de la requête (par exemple `chat_template_kwargs` pour un serveur local).

### Options

| Option                                                                                                           | Rôle (défaut)                                                                                                                    |
| :--------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `<fichier\|lien>`                                                                                                | vidéo ou audio ; un `.srt/.vtt/.ass` en positionnel équivaut à `--subs-from`                                                     |
| `--subs-from <fichier>`                                                                                          | saute l'ASR et traduit ces sous-titres                                                                                           |
| `--from <code>`                                                                                                  | langue source : `auto`, `ja`, `fr`, `ko`, `es`… (`auto`)                                                                         |
| `-o, --out <fichier>`                                                                                            | sous-titres produits (`<nom>.en.<format>` à côté de la source ; un lien : dossier courant)                                       |
| `--format srt\|vtt\|ass`                                                                                         | format de sortie (`srt`)                                                                                                         |
| `--bilingual`                                                                                                    | texte d'origine au-dessus de l'anglais                                                                                           |
| `--burn` / `--mux`                                                                                               | vidéo avec sous-titres incrustés (`<nom>.en.hardsub.mp4`) / piste ajoutée (`<nom>.en.softsub.mkv`) ; `--video-out` change le nom |
| `--glossary <nom\|fichier.json>`                                                                                 | répétable ; `fgc-common`, `guilty-gear`, `art-streams` par défaut ; `--no-glossary`                                              |
| `--context "<texte>"`                                                                                            | contexte libre ajouté aux consignes (jeu, événement, qui parle)                                                                  |
| `--window 20`, `--context-before 5`, `--context-after 3`, `--retries 2`                                          | fenêtre glissante et réparations                                                                                                 |
| `--review`, `--review-apply`                                                                                     | relecture ; `--review-apply` applique les corrections de gravité « error »                                                       |
| `--max-cps 17`, `--max-line 42`                                                                                  | lisibilité (2 lignes au plus)                                                                                                    |
| `--llm-url`, `--llm-model`, `--llm-key-env`, `--llm-timeout 300`, `--llm-extra`, `--temperature 0.2`, `--seed 7` | modèle de traduction                                                                                                             |
| `--dry-run`                                                                                                      | affiche le plan sans rien télécharger, transcrire, traduire ni écrire                                                            |
| `--resume`                                                                                                       | réutilise l'ASR et les fenêtres déjà calculés                                                                                    |
| `--cache-dir`, `--keep-download`                                                                                 | autre dossier de cache ; garder le fichier téléchargé                                                                            |

La source n'est jamais écrasée : si une sortie (`--out`, `--video-out`) désigne le fichier source, l'outil s'arrête avant
tout travail.

### Reprise et cache

Le dossier `.vt-cache/` (à côté de la sortie) contient du JSON : un fichier par tronçon audio (clé = SHA-256 de l'audio
extrait + moteur + modèle + langue), un pour le résumé, un par fenêtre de traduction (clé = SHA-256 du prompt complet :
version des consignes, modèle, température, graine, cues, contexte traduit, entrées de glossaire). Il est toujours
écrit ; il n'est relu qu'avec `--resume` (une relance après coupure ne refait que ce qui manque). Changer le modèle, un
glossaire ou une consigne invalide les fenêtres concernées. Un lien téléchargé est supprimé à la fin sauf
`--keep-download` (à combiner avec `--resume` pour ne pas retélécharger).

### Glossaires

Trois fichiers dans `glossaries/`, du JSON lisible et modifiable (`--glossary mon.json` ajoute ou remplace des entrées
par `id`). Chaque entrée : formes sources (japonais, anglais, français, espagnol), rendu anglais préféré (`en`), rendus
acceptés (`alt`), rendus littéraux interdits (`avoid`), note de sens, `confidence`, `ref` vers les sources du fichier.

| Fichier            | Entrées | Contenu                                                                                                                                                                                                                                                                           |
| :----------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fgc-common.json`  | 92      | oki/okizeme, frame trap, mixup, tech, neutral, footsies, meaty, reversal, cross-up, anti-air, 暴れ, 確反, 固め, 詐欺飛び, 差し返し, 判定…, Street Fighter 6 (Drive Gauge, Burnout, Drive Impact/Parry/Rush, Punish Counter), Tekken (Heat, Rage Art, Power Crush), argot FR et ES |
| `guilty-gear.json` | 272     | 34 personnages (noms officiels japonais et anglais, roster Strive v2.02 du 2026-07-01), systèmes (Roman Cancel et couleurs, Burst, Tension, R.I.S.C., Faultless Defense, Wall Break, Counter Blitz…), 200 noms de coups (Gun Flame, Volcanic Viper, Potemkin Buster…)             |
| `art-streams.json` | 75      | modes de fusion de Clip Studio Paint (乗算 → Multiply…), 液タブ/板タブ, 原画, 中割り, 作画崩壊, 二次創作, ネーム, vocabulaire de dessin                                                                                                                                           |

**Niveaux de confiance** (champ `confidence`, vérifié le 2026-10-06) :

- `verified` : le terme et son rendu anglais figurent dans la source citée.
- `partial` : le côté anglais est vérifié ; certaines formes source (listées dans `unverifiedSrc`) viennent de ma
  connaissance, pas d'une source (par exemple surnoms japonais ou noms japonais de coups).
- `unverified` : usage courant que je n'ai pas recoupé avec une source primaire (par exemple 厚塗り, ぶっぱ, argot FR).

Répartition : `fgc-common` 44 vérifiées / 33 partielles / 15 non vérifiées ; `guilty-gear` 209 / 63 / 0 ;
`art-streams` 37 / 7 / 31. Sources lues : Dustloop (Glossary, GGST et ses pages Mechanics, Universal Strategy et
personnages), site officiel Arc System Works GGST (liste et fiches japonaises des 34 personnages), Wikipedia ja
(対戦型格闘ゲーム, GUILTY GEAR -STRIVE-, ストリートファイター6, 原画, 動画, 作画崩壊, 二次創作, ネーム, ペンタブレット),
Wikipedia en (Street Fighter 6, Tekken 7/8), Clip Studio Paint User Guide (JA et EN). Non lu : les listes de commandes
officielles japonaises (ce sont des images), donc les noms japonais de coups sont tous `partial`. Supercombo wiki et
Fandom n'ont pas pu être lus (protection anti-robot, HTTP 403) ; je n'ai pas contourné la protection.
Les mises à jour de jeu peuvent changer les noms (Strive 2.00 de 2026-04 a retiré Wild Assault et refondu les systèmes).

La correspondance japonais/anglais des modes de fusion de Clip Studio Paint vient de l'ordre identique des deux listes
officielles (28 modes de part et d'autre).

### Qualité mesurée

Un échantillon de 15 cues japonaises écrit pour ce test (commentaire d'une situation d'oki Sol contre Potemkin dans
Guilty Gear Strive). Modèle : **Qwen3-4B-Instruct-2507 Q4_K_M** (le GGUF installé par `aphrody model list`), servi par
`llama-server` (build 11312) sur CPU, lancé pour l'occasion ; la passerelle aphrody (8795) n'était pas démarrée. Colonne
« Ligne à ligne » : le même modèle, un prompt « Translate this Japanese subtitle line into English » par cue, sans
contexte ni glossaire. Colonne « video-translate » : `--from ja --context "Guilty Gear Strive match commentary…"`.

| #   | Japonais                                                                     | Ligne à ligne                                                                                                    | video-translate                                                                      |
| :-- | :--------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| 1   | はい、ここでダウンを取りました。ここからソルの起き攻めですね。               | Yes, I took the down here. Now it's Sol's breakout from here.                                                    | Yeah, took a knockdown here. Sol's oki pressure from now on.                         |
| 2   | まずバンディットブリンガーを重ねて、ガードさせてから                         | First, stack the Bandit Bringer and guard it, then                                                               | First, meaty setup with Bandit Bringer, then keep him on guard.                      |
| 3   | あー、ここで暴れますか？ いや、それは確反ありますよ。                        | Ah, are you going to explode here? No, that's definitely possible.                                               | Ah, are you mashing there? No, that's a guaranteed punish.                           |
| 4   | ポチョムキンは投げ抜けできないので、ガードを固めるしかないんですけど         | Pochomkin can't escape, so I have to solidify my guard.                                                          | Potemkin can't tech throws, so he's stuck in pressure.                               |
| 5   | ここでロマキャン！ 赤ロマで繋ぎました。                                      | Here we go, Romacan! Connected with red Romacan.                                                                 | Roman Cancel! Connected with Red RC.                                                 |
| 6   | 詐欺飛びからのめくり、これはきついですね。                                   | This sudden turn after a scam is quite tough, isn't it?                                                          | Cross-up from a safe jump — that's brutal.                                           |
| 7   | ガー不じゃないですか、これ。ずるいなぁ（笑）                                 | Gah, isn't that cheating? So sneaky (smile)                                                                      | Unblockable, right? So sneaky, haha.                                                 |
| 8   | 画面端まで運んで、ウォールブレイクが見えてきました。                         | We carried it to the edge of the screen, and the wall break became visible.                                      | Carried all the way to the corner — wallbreak's visible now.                         |
| 9   | ここでバーストを読んでますね。青バーストを読んで、ガードして確反を取る       | Here we're reading the burst. Reading the blue burst, guarding, and taking the counterattack.                    | Reading the burst here — blue burst, guard, then take the guaranteed punish.         |
| 10  | あーっと、バーストしなかった！ そのままコンボが入ります。                    | Ahh, didn't burst! The combo continues.                                                                          | Ah! Didn't do the burst! Combo just goes in.                                         |
| 11  | いやー、ほんとにこの読み合い、見ててしびれますね。                           | No way, watching this match is really thrilling.                                                                 | Man, this read game is intense to watch.                                             |
| 12  | 立ち回りはポチョムキンが有利でも、一度ダウンを取られるとソルは本当にきつい。 | Although Pochomkin has the advantage in positioning, once Sol takes a knockdown, it becomes extremely difficult. | Potemkin has the edge in neutral, but once he takes a knockdown, Sol becomes brutal. |
| 13  | ヒット確認が完璧です。ヴォルカニックヴァイパーで締めました。                 | Hit confirmation is perfect. Finished with volcanic viper.                                                       | Perfect hit-confirm. Closed it with Volcanic Viper.                                  |
| 14  | ワンチャンあるかなと思ったんですけど、ちょっと厳しいですね。                 | I thought there was a chance, but it's a bit tough.                                                              | Thought we had a shot, but it's pretty tight.                                        |
| 15  | さあ、ラウンドを取ったのはソルです！                                         | Alright, round taken by Sol!                                                                                     | Alright, Sol takes the round!                                                        |

Lecture (de l'auteur, une seule personne, un seul échantillon, pas une évaluation en aveugle ni par un locuteur natif) :

- Ligne à ligne : contresens ou termes inventés sur les cues 1, 2, 3, 4, 5, 6, 11, 12 (« took the down », « explode »,
  « definitely possible », « Pochomkin », « Romacan », « a scam »).
- video-translate : termes de jeu et noms corrects partout (oki, mash, guaranteed punish, Roman Cancel, safe jump,
  cross-up, unblockable, Potemkin, Volcanic Viper). Il reste **un vrai contresens** : cue 12, « Sol becomes brutal » au
  lieu de « Sol is in real trouble » (le ligne à ligne y est meilleur). La cue 4 (« stuck in pressure ») est approximative :
  ガードを固める signifie « se mettre en défense », pas « être sous pression ». J'ai ajouté ce cas à la note de l'entrée
  `katame` après avoir constaté que le glossaire induisait le modèle en erreur.
- Coût : 2 min 19 s pour les 15 cues (résumé + une fenêtre, CPU ; 2 min 28 s avec `--review`), contre 27 s en ligne à ligne : les consignes
  et le glossaire alourdissent le prompt. Sur un GPU ou via la passerelle la durée est sans commune mesure. Compter environ
  9 s par cue avec ce modèle sur CPU.
- Les sorties varient d'un lancement à l'autre : entre mes deux lancements, 9 cues sur 15 diffèrent légèrement (les consignes de résumé et une note de glossaire avaient aussi changé entre les deux). Le tableau montre le second.
- Le modèle de 4 milliards de paramètres est le minimum réaliste ; un modèle plus gros traduira mieux. Je n'ai mesuré
  aucun autre modèle.

Mesuré et non mesuré, en bref : la traduction a été mesurée sur ces 15 cues avec ce seul modèle ; l'ASR n'a **pas** été
exécuté sur un vrai fichier audio avec un vrai moteur (ni whisper.cpp ni faster-whisper n'étaient installés ici).

### Limites à connaître

- **`--review`** : la passe de relecture dépend du modèle. Avec le modèle de 4 milliards de paramètres elle a signalé 5
  « erreurs » sur 15 cues dont aucune n'en était une, et proposé une correction qui inventait un nom (« Banished
  Bringer »). Elle n'a pas relevé le vrai contresens de la cue 12. Utilise `--review` pour lire la liste
  (`<sortie>.review.json`), pas `--review-apply`, sauf avec un modèle fort ; `--review-apply` refuse déjà les
  suggestions qui contiennent des caractères japonais ou des noms propres inconnus du texte et du glossaire.
- Le résumé global est produit par le même modèle et peut halluciner un détail ; il n'est donné que comme contexte.
- Les noms japonais de coups ne sont pas recoupés (listes officielles en images) ; l'ASR peut aussi les mal entendre.
- Une cue qui reste au-dessus de 17 caractères/seconde faute de place est comptée dans le bilan, pas modifiée.
- Pas de diarisation (qui parle) : le modèle déduit les locuteurs du contexte.

### Incrustation et piste de sous-titres

- `--burn` : `ffmpeg -vf subtitles=…` (libass), vidéo H.264 `-crf 18`, audio copié. Le fichier de sous-titres est copié
  sous un nom fixe dans un dossier temporaire et ffmpeg y est lancé : le filtre ne voit qu'un nom relatif, donc aucun
  échappement de chemin n'est nécessaire (lettres de lecteur Windows, `\`, `:`, guillemets, virgules, crochets). Testé
  sous Linux avec des chemins contenant `'`, `:`, `,`, `;`, `[ ]` et des espaces ; non testé sous Windows.
- `--mux` : vidéo et audio copiés, piste de sous-titres ajoutée (`language=eng`, par défaut), `.mkv` (srt/ass/webvtt) ou
  `.mp4` (`mov_text`).

### Confidentialité

L'outil ne contacte que : l'endpoint LLM (`--llm-url`, local par défaut ; si l'hôte n'est pas local, le texte des
sous-titres y est envoyé et un avertissement est affiché avant), l'endpoint ASR si tu en donnes un, `yt-dlp` pour un lien
que tu donnes, et, avec le moteur faster-whisper, PyPI et Hugging Face via `uv` au premier lancement. `--dry-run` ne fait
que lire des fichiers locaux et interroger `/models` de l'endpoint LLM.

### Vérifié et non vérifié

Vérifié : 61 tests `bun test` (faux serveur OpenAI avec `Bun.serve`, vrai `ffmpeg` sur un clip généré par `lavfi` :
incrustation et mux avec chemins piégés, tronçons, recouvrement, whisper-cli simulé, script faster-whisper exécuté avec une
bibliothèque factice, endpoint ASR simulé, yt-dlp simulé), `tsgo --noEmit`, oxlint, oxfmt ; traduction réelle des 15 cues
ci-dessus avec Qwen3-4B-Instruct-2507 sur `llama-server`.
Non vérifié : whisper.cpp et faster-whisper réels, un vrai lien `yt-dlp`, Windows, un modèle autre que celui du tableau,
des vidéos longues (plus de 1 h), le coréen et l'espagnol.
