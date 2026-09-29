# Google Cloud Translation API & Ultra Engine — Open-Source Zero Rate-Limit

Architecture de reproduction fidele et ultra-optimisee de **Google Cloud Translation API (v2 & v3)** integree dans le moteur Aphrody Web.

Ce module fusionne et depasse les capacites des **3 meilleurs projets open-source mondiaux** de Google Translate :
1. **vitalets/google-translate-api** (Node.js/TS) : Prononciation phonetique (Romaji, Pinyin, IPA), auto-correction / Did-you-mean ("Essayez avec cette orthographe"), conservation du corps brut de la requete.
2. **ssut/py-googletrans** (Python) : Dictionnaire bilingue complet par partie du discours (nom, verbe, adj), definitions monolingues avec exemples d'usage, scores de frequence et variantes alternatives, geo-rotation multi-domaines Google.
3. **soimort/translate-shell** (CLI / Shell) : Synthese vocale native Google Text-to-Speech (TTS) avec decoupage intelligent de longs textes et fusion binaire MP3, support de l'entree pipeline STDIN, affichage bilingue enrichi.

---

## 1. Fonctionnalites Principales

- **Drop-in Compatible Google Cloud API :** Remplace l'API payante `translate.googleapis.com` avec les memes structures JSON (`POST /language/translate/v2`, `POST /language/translate/v2/detect`, `GET /language/translate/v2/languages`, `POST /v3/projects/...:translateText`).
- **Zero Rate-Limit Garanti (Multi-Tiering) :**
  1. **Tier 0 : Cache SQLite WAL local** (`~/.bxc/translations.sqlite`) indexe par SHA-256. 0 ms de latence sur requete deja vue.
  2. **Tier 1 : Rotation Web RPC optimiste** avec geo-rotation (`google.com`, `google.fr`, `google.co.jp`, `google.de`, `google.co.uk`) et client Chrome autorise (`dict-chrome-ex`).
  3. **Tier 2 : Session Web Mobile authentifiee** (`translate.google.com/m` avec cookies de session de `~/.bxc/cookies/google.json`).
  4. **Tier 3 : Fallback Gemini LLM (flash)** pour preservation absolue du HTML et du contexte complexe.
  5. **Tier 4 : Fallback gcloud ADC officiel** (`X-Goog-User-Project: aphrody`).
- **Synthese Vocale Native TTS :** Endpoint `/language/translate/v2/tts`, module `defaultTTS` et commande `aphrody web google tts` generant des flux audio MP3 de qualite native avec cache local et decoupage transparent des textes de plus de 200 caracteres.
- **Dictionnaire Bilingue & Definitions :** Extraction des classes grammaticales, genres, articles, traductions inverses et definitions contextuelles.
- **Prononciation & Transcription Phonetique :** Extraction automatique des transcriptions Romaji, Pinyin et alphabet phonetique international (IPA).
- **Auto-Correction Orthographique :** Detection et suggestion automatique des fautes de frappe de l'utilisateur (`didYouMean`).

---

## 2. Demarrage du Serveur REST Drop-in

```bash
# Lancer l'emulateur local sur le port 8089 (par defaut)
bun src/cli/index.ts google translate --serve --port 8089
```

### Endpoints REST Disponibles :
- `POST/GET /language/translate/v2` : Traduction standard (ou enrichie avec `detailed=true`).
- `POST/GET /language/translate/v2/detect` : Detection de langue (< 1 ms).
- `GET      /language/translate/v2/languages` : Liste des 195 langues supportees (avec `target=fr` optionnel).
- `GET/POST /language/translate/v2/tts` : Generation et streaming audio MP3 (`q=texte&tl=fr`).
- `POST     /v3/projects/:p/locations/:l:translateText` : Emulation de l'API v3.
- `GET      /healthz` : Sonde d'etat du service.

---

## 3. Commandes CLI Aphrody Web

```bash
# 1. Traduction simple
bun src/cli/index.ts google translate "Hello sovereign world" --target fr

# 2. Traduction enrichie (prononciation, dictionnaire, definitions, variantes)
bun src/cli/index.ts google translate "apple" --target fr --detail

# 3. Traduction avec synthese vocale audio MP3
bun src/cli/index.ts google translate "Victoire divine" --target ja --tts victoire_ja.mp3

# 4. Synthese vocale dediee (TTS)
bun src/cli/index.ts google tts "Bienvenue sur le moteur Aphrody Web" --target fr --out welcome.mp3

# 5. Entree par pipe STDIN
echo "Machine learning system" | bun src/cli/index.ts google translate - --target ja

# 6. Detection de langue ultra-rapide
bun src/cli/index.ts google translate --detect "Bonjour tout le monde"

# 7. 195 langues officielles localisees
bun src/cli/index.ts google translate --languages --target fr
```

---

## 4. Outils MCP (Model Context Protocol)

Enregistres dans `src/mcp/server.ts` :
- `aphrody_google_translate` : Traduction unitaire ou par lot (texte ou HTML), supporte `detailed: true` pour prononciation, dictionnaire et auto-correction.
- `aphrody_google_tts` : Synthese vocale renvoyant soit le fichier sauvegarde, soit le buffer audio encode en Base64.
- `aphrody_google_detect_language` : Detection de langue instantanee.
- `aphrody_google_supported_languages` : Repertoire des 195 langues officielles.

---

## 5. Validation et Tests

```bash
# Executer la suite complete des tests de traduction et TTS (23 tests passants)
bun test test/unit/google-translate-engine.test.ts test/unit/google-translate-advanced.test.ts

# Verification statique stricte TypeScript
bunx tsc --noEmit
```
