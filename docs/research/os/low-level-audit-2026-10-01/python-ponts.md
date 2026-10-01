# Audit python-ponts — espace Python d'Aphrody et ponts natifs (vague 3, 2026-10-01)

Niveau de preuve global : P1 (statique). Lecture seule : aucun cargo, aucun `uv sync`/`pip install`/`pytest`, aucune écriture hors /tmp/audit-low-level.
Seules exécutions : `python3` pour l'analyse de texte (tomllib sur uv.lock, comparaison AST, test de regex de `command_guard.py` sur des chaînes — aucune commande lancée), `nm -D`, `sha256sum`, `git`.
Grille : agents `security-engineer`, `ffi-architect`, `rust-engineer` ; skills `dpapi-timing-audit`, `aphrody-train` ; correction du propriétaire reçue en cours d'audit (voir §0).

## 0. Doctrine appliquée (correction du propriétaire, docs/reference/os/YOLO-AUTHORITY.md)

Aphrody est un OS YOLO. Ne sont donc PAS reprochés : `subprocess`, `shell=True` en tant que surface d'autorité, `eval`/`exec`, autorité large, absence de sandbox/approbations. Je ne recommande ni sandbox ni approbation.
Restent traités : fiabilité et intégrité des désérialisations/téléchargements non authentifiés, authentification des listeners (le noyau est « un seul domaine de confiance OS-user » : socket Unix 0600 ; un listener TCP loopback n'a pas cette propriété), secrets, chaîne d'approvisionnement, durée de vie des pointeurs, exactitude des revendications, dérive de propriété, réutilisation de briques.
Les sites `exec`/`eval`/`subprocess` sont listés en §4.2 comme inventaire neutre.

## 1. Périmètre réellement lu

aphrody-py (git 690 fichiers, 612 `.py`, ~200 k lignes dont ~145 k importées : Ren'Py, SDK Google Antigravity) :
- pyproject.toml racine (1-60), uv.lock (analyse tomllib complète : 266 paquets), tous les pyproject.toml des 13 membres, `packages/ai/py/pyproject.toml`, `.gitignore`, `AGENTS.md`, `README.md`, `docs/sdk/{PLAN,workspace-audit}.md`, `docs/migration/python-import-manifest.json` (clés, summary, deduplicated, additionalImports), `.github/workflows/{python-sdk,aphrody-ci}.yml`, `.venv/lib/python3.12/site-packages` (existence de langextract, rapidocr, niepy.pth).
- `packages/ai/py/aphrody/` : `build_backend.py` (1-296), `native/{Cargo.toml,source.json}`, `aphrody/{_paths,command_guard,agent,web_browser,voice_server,blender,soul_creator,gemini_web(load_cookies),session_db(SQL)}.py`, `auth/{credential_store,credentials}.py`, `cli/{setup,blender,main(voice)}.py`, `blender_addon/aphrody_addon.py` (1-60, 90-200, 340-470), `inference/harmony_reasoning.py` (300-420), `document/docling_extractor.py` (205-300), `rag/` (imports natifs), `scripts/setup_secrets.py`.
- `packages/ai/py/aphrody-train/src/aphrody_train/{shenron_ffi,protocol,lora}.py` (lecture complète), grep des autres.
- `packages/shenron/relecture-ocr/src/relecture_ocr/server.py` (1-216), `tools/koharu/model-tools/*`, `tools/infra/scripts/{install-developer-cli,python-workspace-dispatch,rg/provision-vps-env}.py`, `tools/ai/scripts/build-*-cookie-jar.py`, `tools/{packaging,sdk}` (grep zipfile/tarfile).
- `packages/iecode/src/{IEStrikers,inz_cond,iepy/natif,iepy/renpy(grep ciblé)}`, `packages/os/drive/{README,adapters}` (diff), SDK Antigravity (`local_connection.py` 1405-1475, 1680-1790).
aphrody : `py/aphrody-train/*` (diff AST vs aphrody-py), `scripts/*.py` (symlinks), `services/shenron/relecture-ocr/serveur.py`, `crates/interop/ffi/src/lib.rs` 225-530 et 880-1000, `crates/os/stdio-capture/src/lib.rs` 1-60, `crates/ai/train/src/{runner,events}.rs`, `crates/ai/rag-python/src/lib.rs` (complet), `crates/ai/rag-core/src/vectors_f64.rs` (82-216), `crates/os/kernel/src/{auth,remote,transport}.rs` (extraits), `docs/architecture/os/ARCHITECTURE.md` 195-238, `config/developer-cli-tools.json`, `apps/cli/src/lib.rs` 2301-2341.
iecode : `src/niepy/niepy/{_ffi,formats,vfs}.py`, `scripts/ruzu/{fetch-moltenvk,package-appimage}.py`, grep de motifs sur les 223 `.py` hors third_party.

## 2. Ce qui est correct et à garder

- **Pont PyO3 `aphrody_rust`** (crates/ai/rag-python/src/lib.rs) : `checked_mul` + égalité exacte des longueurs avant tout `unpack` (l.8-20, 62-70, 118-124), `py.detach(...)` (= relâche le GIL) autour de tous les calculs (l.76-170), `update_centers` valide `labels.len()` et `label < centers.len()` (rag-core vectors_f64.rs:186-191). Les 4 modules noyau d'`aphrody-py/native/src` sont **octet-identiques** à HEAD du monorepo (sha256 recalculés : fusion 32ffa5e1…, vectors_f64 8a1db013…, vectors_f32 6df8f7e6… ; `source.json` revision 812c3b0f existe, dernier commit touchant ces chemins).
- **`build_backend.py`** : hash SHA-256 de l'archive vérifié avant extraction, liste blanche de 4 membres, plafond 1 Mo, pas de lien symbolique, écriture atomique, RECORD recalculé (l.31-100, 171-238). `maturin==1.14.1` épinglé, `locked = true`. Patron à généraliser (§7).
- **CI** (python-sdk.yml:44-45) : actions épinglées par SHA, `uv` 0.12.17, build hors checkout, `--no-sources`, permissions `contents: read` ; `tools/sdk/verify-wheel.py:112-114` refuse toute dépendance `name @ url` dans le wheel.
- **uv.lock** : 266 paquets, 252 PyPI + 1 `download.pytorch.org/whl/cu129` (index `explicit = true`, torch seulement) + 13 membres ; **0 source git/URL, 0 fichier sans `hash = "sha256:…"`** ; `required-version = "==0.12.17"` ; `requires-python = "==3.12.*"`. Déjà présents dans le lock (réutilisables sans nouvelle dépendance) : `safetensors 0.8.0`, `cffi 2.1.1`, `onnx 1.23.0`, `onnxruntime 1.30.0`, `huggingface-hub 0.36.2`, `numpy 2.5.3`, `lief 1.0.0`, `magika 0.6.2`, `defusedxml 0.7.1`, `filelock`, `truststore`.
- **`AgentClient`** (agent.py:100-323) : stdio NDJSON vers `aphrody app-server`, requêtes entrantes du serveur refusées (-32601, l.~254), délais, `_fail_all`, arrêt gracieux. **`WebBrowserClient`** (web_browser.py:46,137) : MCP stdio vers `aphrody-kernel mcp`, délais bornés. Les deux n'ouvrent aucun port.
- **`lora.py`** (aphrody-train) : `local_files_only=True`, adaptateur safetensors, convertisseur GGUF validé, remplacement atomique (`os.replace`), pas de `trust_remote_code`, pas de `pickle`. **Le runner Rust** (runner.rs:262-300) refuse un événement d'un autre `job_id`, vérifie taille + SHA-256 de chaque artefact avant de le déclarer. Schéma Python (`protocol.py`) = schéma Rust (`events.rs`) champ par champ.
- **Ren'Py importé** : `renpy/loadsave.py:636,654` ne dépile qu'après `renpy.savetoken.check_load` (signatures, `savetoken.py:99`) ; `tarfile.extractall(..., filter="data")` (iepy/natif/construire.py:238,240) ; aucun `verify=False` dans les trois dépôts.
- **iecode** : `scripts/ruzu/fetch-moltenvk.py:20-45` (SHA-512, tmp + `os.replace`, membre régulier) et `package-appimage.py:44-60` (SHA-256) = le bon modèle de téléchargement vérifié.
- **niepy** (iecode/src/niepy/niepy/_ffi.py:33-85,163-280 ; formats.py:18-30) : chaque symbole a `argtypes`/`restype` ; `NieBytes` rendu par Rust est copié puis libéré **exactement une fois** (`prendre_octets`, `finally`), poignée VFS fermée par contexte. Meilleur pont ctypes de l'écosystème (réserves : pas de contrôle d'ABI ni d'intégrité de la lib, recherche partant du cwd, `_ffi.py:100-130`).
- `agent-home`, `session_db.py` : SQL paramétré (les f-strings ne portent que des noms de schéma constants), `forensic/inventory.py:403` `follow_symlinks=False` par défaut.

## 3. Constats

| ID | Sév. | Emplacement | Constat | Preuve |
|---|---|---|---|---|
| PY-01 | HAUTE | aphrody/_paths.py:28-34,86-92 ; cli/setup.py:98,116,218 ; aphrody-py/.gitignore | Le dépôt de secrets est `<plus proche ancêtre du cwd contenant .git>/var/secrets` : jeton OAuth, cookies Google, clé de compte de service atterrissent dans **n'importe quel dépôt** où l'on se trouve. `aphrody-py/.gitignore` n'ignore ni `var/` ni `.env` (le docstring `_paths.py:6` promet « git-ignored »). `setup_secrets` écrit la clé JSON du compte de service + **écrase `.env`** du dépôt courant sans sauvegarde (`write_text`, l.218) | [V] (`git check-ignore var/secrets/x` → non ignoré) |
| PY-02 | HAUTE | aphrody/cli/setup.py:30-37 ; tests/test_cli_setup.py:58,130 | `run_command(args: list)` appelle `subprocess.run(args, shell=True)` : sur POSIX seul `args[0]` est la commande, les autres éléments deviennent les arguments du shell. `aphrody setup` ne peut pas fonctionner sous Linux/macOS (`gcloud --version` → `gcloud` nu). Les tests simulent `subprocess.run` et masquent le défaut. (Défaut de **correction**, pas de surface d'autorité.) | [V] sémantique CPython documentée ; non exécuté |
| PY-03 | HAUTE | tools/koharu/model-tools/src/koharu_model_tools/export_dinov2.py:40 ; export_models.py:30 | `torch.hub.load("facebookresearch/dinov2", …)` sans référence (branche par défaut) : le `hubconf.py` du moment s'exécute et le checkpoint est un pickle récupéré sans empreinte ; `weights="DEFAULT"` change selon la version de torchvision. Les `.safetensors` produits alimentent le crate Rust Koharu : chaîne d'approvisionnement non épinglée et non reproductible (docs/sdk/workspace-audit.md:21 le reconnaît « à qualifier ») | [V] code ; exploitation [P] |
| PY-04 | MOYENNE | blender_addon/aphrody_addon.py:361-375,402,409 ; aphrody/blender.py:92 | Listener TCP `localhost:9876` (AF_INET) **sans authentification** ; `listen(1)` + boucle d'accept qui traite le client en ligne (`_handle_client`, `settimeout(None)`) : un client inactif bloque tout ; `buffer += data` non borné jusqu'à JSON valide (client symétrique `_receive_full_response` aussi). Contrairement au noyau (UDS 0600), tout utilisateur local peut le piloter. L'exécution de code qu'il offre est voulue (YOLO) ; c'est l'**absence d'authentification et de bornes** qui est reprochée | [V] |
| PY-05 | MOYENNE | aphrody/voice_server.py:420-456,524 ; relecture_ocr/server.py:165-166,208 | WebSocket voix `127.0.0.1:8789` et UI `:8790`, OCR HTTP `127.0.0.1:8791` : loopback par défaut (bon), mais **ni jeton ni contrôle d'Origin** : une page web quelconque peut ouvrir `ws://127.0.0.1:8789` (détournement inter-site) ou POSTer en `text/plain` sur `/lire` (le corps est lu quel que soit le Content-Type, l.166). OCR : `Content-Length` négatif/énorme non borné (`rfile.read(length)`), `request` non typé (`request.get` sur une liste lève hors du `try`), cache indexé par le seul hash image (pas par version du modèle). `host` du WS est configurable sans garde (`cli/main.py:373`) | [V] |
| PY-06 | MOYENNE | docs/architecture/os/ARCHITECTURE.md:222,236 ; aphrody/web_browser.py:46,137 ; agent.py:133 | « SDK uv » : le doc dit « protocole opérationnel, paquet autonome prévu » (honnête). Dans le code il **n'existe aucun client Python** du endpoint noyau (socket Unix/pipe `APHRODY_OS_SOCKET`, `initialize` avec `authToken`, `system/register_subsystem`) : aucune occurrence de `register_subsystem`, `AF_UNIX`, `APHRODY_OS_AUTH_TOKEN` dans les `.py` des trois dépôts. Les deux clients existants sont des enfants stdio (`aphrody-kernel mcp`, `aphrody app-server`), binaire cherché dans le PATH. Manque, pas faux | [V] (grep sur aphrody, aphrody-py, iecode) |
| PY-07 | MOYENNE | aphrody-train/src/aphrody_train/shenron_ffi.py:14-45,60,101-103,130,146 ; aphrody/py/aphrody-train/…/shenron_ffi.py:14-38,49 | Confirme ART-14 : pas d'intégrité ni de contrôle d'ABI (`shenron_abi_version` déclaré, jamais comparé), recherche dans `~/src/{,aphrody-ai/}target/…` (chemin obsolète), repli `"."` (l.30), un `*_LIB` inexistant est ignoré en silence. Le code d'état et `stderr` du JSON `{"code","stdout","stderr"}` sont jetés : un échec devient un `JSONDecodeError`. **Zéro consommateur** dans aphrody-py, aphrody/py, crates et docs (grep) : pont mort, présent en deux copies divergentes. Le motif propriétaire/libération est correct (`c_void_p` → `cast(c_char_p)` copie → `shenron_string_free` en `finally`), `c_char_p` pour `version`/`persona_prompt` correct (statique/`OnceLock`). Risque latent si on le branche : `with_captured_stdio` redirige les fd 1/2 du **processus** (stdio-capture/src/lib.rs:9-12) ; `ctypes.CDLL` relâche le GIL, donc les `print`/NDJSON d'autres threads Python (p. ex. `TrainEmitter`, protocol.py:24) seraient avalés ou injectés dans la capture | [V] consommateurs ; [P] interférence |
| PY-08 | MOYENNE | crates/ai/train/src/runner.rs:61-85,138-139,190-194 ; docs « ../aphrody-py » | Le runner lance `uv run --project <aphrody-py> --package aphrody-train [--extra full]` **sans `--locked`/`--frozen`** (le script `python-workspace-dispatch.py:70-88` met `--locked`) : au premier job uv peut re-résoudre, écrire `uv.lock` et télécharger plusieurs Go de torch cu129. `stderr` vers `Stdio::null()` (diagnostic perdu), pas de délai ni `kill_on_drop` (Python orphelin tenant le GPU si le futur est abandonné), `PYTHONPATH` écrasé. Le chemin d'artefact annoncé par l'enfant n'est pas confiné à `output_dir` (le hash est vérifié, pas la provenance) avant `register_promoted_model` | [V] |
| PY-09 | MOYENNE | aphrody/scripts/{python-workspace-dispatch,install-developer-cli,ops/ovh,smoke-aphrody-stack-local,rg/*}.py (8 liens, mode 120000) ; systemd/rg-bot.service:31 ; docs/operations/infra/IMMUTABLE-RELEASES.md:166 | Huit scripts du monorepo sont des **symlinks suivis par git vers `../../aphrody-py/…`**, hors dépôt : pendants dans un clone propre, y compris pour `provision-vps-env.py` (jetons du bot) et le script de fumée cité comme porte de release. Contredit AGENTS.md d'aphrody-py (« no checkout-neighbor path is a published runtime dependency ») et CLAUDE.md (« mapped consumers pass from a clean clone »). Même couplage voisin dans runner.rs:61-85 | [V] `git ls-files -s` |
| PY-10 | MOYENNE | tools/infra/scripts/install-developer-cli.py:151-170 ; config/developer-cli-tools.json ; iecode/natif/construire.py:234-240 ; voice_server.py:45-50,109-119 | Installations non authentifiées : `cargo install cargo-binstall --locked` sans version, puis `cargo binstall --no-confirm … --strategies crate-meta-data,quick-install` sur **25 paquets dont 0 épinglé** ; `construire.py` télécharge SDL 2.0.20/HarfBuzz/FFmpeg sans empreinte ni délai (extraction protégée par `filter="data"`) ; `voice_server.py` : `urlretrieve` sans délai, ni hash, ni écriture atomique (un téléchargement interrompu laisse un fichier que `os.path.exists` accepte ensuite), modèle sur `resolve/main` flottant, paire v0_19 / voices-v1.0 apparemment non appariée [P] | [V] ; appariement [P] |
| PY-11 | MOYENNE | pyproject.toml:30-31 ; packages/ai/py/pyproject.toml:16 ; uv.lock:1491-1493 ; packages/ai/py/antigravity-sdk-python/pyproject.toml:46 | La source `langextract = { git = "https://github.com/google/langextract.git" }` (sans `rev`) est déclarée deux fois mais **inopérante** : le lock résout `langextract 1.7.0` depuis PyPI et le venv n'a pas de `direct_url.json`. Soit la déclaration est morte (alors elle trompe), soit le lock est périmé ; dans les deux cas, doc et lock se contredisent. Autour : `packages/ai/py/pyproject.toml` (ancienne racine) duplique sources, groupes, pytest et ruff (c'est lui que ruff trouve en premier : ligne 80, jeux E/W/F/I/N/UP/B/SIM/PL/RUF/D) alors que le manifeste dit « moved to the root » ; aucun jeu `S` (bandit) ni pyright/mypy pour le code first-party ; `iepy/pyproject.toml:90` exclut `"*.py"` ; backends de build (`hatchling`, `setuptools>=68`) non verrouillés ; lock en `==3.12.*` (borne `iepy`) alors que membres et CI visent 3.10-3.14 ; 5 verrous archivés `docs/migration/locks/**/uv.lock` contre le README « the only lockfile » ; `ecdsa 0.19.2`/`rsa 4.9.1` (Ren'Py, signatures de sauvegarde) non constants en temps [P, publique seulement] | [V] |
| PY-12 | MOYENNE | aphrody-py : dérive de propriété (voir §6) | Doublons divergents entre dépôts : aphrody-train ×2, relecture-ocr ×2, générateurs de fixtures ×2, adaptateurs Drive ×2, sources IECODE ×2, et références du manifeste vers un `packages/nie` supprimé (49a8871) | [V] |
| PY-13 | BASSE | crates/ai/rag-python/src/lib.rs:16,49,225 ; rag-core/src/vectors_f64.rs:93-99 ; native/Cargo.toml:15 | Robustesse du pont PyO3 : avec `width == 0`, `rows` n'est pas borné (`vec![vec![]; rows]`) et `similarities_flat` alloue `vec![0.0; left_rows*right_rows]` (jusqu'à `isize::MAX/8`) : cinq entiers Python suffisent à faire avorter l'interpréteur sur OOM ; le tri de `top_k_cosine_similarity` avec `partial_cmp(...).unwrap_or(Equal)` n'est pas un ordre total (NaN) et peut paniquer en Rust ≥1.81 [P] ; recette wheel en `pyo3 =0.29.0` alors que le Cargo.lock du monorepo est en 0.29.2 | [V] code ; panique [P] |
| PY-14 | BASSE | aphrody/command_guard.py:1-258 ; aphrody/__init__.py:36,89,121 | Revendication non tenue : `CommandGuard` (« security guard enforcing headless blocklists ») est exporté mais **n'a aucun appelant** hors tests, et la liste noire se contourne (testé sur chaînes, rien exécuté) : `python3.12 -c …`, `python3 -W ignore -c …`, `curl … \| sudo bash`, `eval $(… \| base64 -d)`, `r\m -rf /`, `$(printf rm) -rf /` passent. Conforme à la doctrine YOLO de ne pas l'utiliser ; il faut cesser de le présenter comme une barrière (retirer ou étiqueter), pas le renforcer | [V] regex testées |
| PY-15 | BASSE | aphrody/auth/credential_store.py:287-305 ; tools/ai/scripts/build-{grok,x}-cookie-jar.py:39-42,56-62 | Écritures de secrets : le chemin de repli `tmp.write_bytes` (umask par défaut) s'exécute si `os.open`/l'écriture échoue — et l'`os.close(fd)` après `with open(fd)` est un double close qui déclenche ce repli ; `.tmp` préexistant (ou lien) réutilisé avec son mode ; cookie jars : `write_text` puis `chmod` (fenêtre en 0644, répertoire parent créé en 0755) | [V] |
| PY-16 | BASSE | iecode/IEStrikers/common.py:142 ; calcprogress.py:30 ; iepy/natif/surcharge.py:109-113 ; sonde_nie_exe.py:38-40,113 ; soul_creator.py:231,261 ; harmony_reasoning.py:335,410 ; docling_extractor.py:288 ; whisper_transcribe.py:407 | Fiabilité/intégrité : `yaml.load(…, Loader)` avec le chargeur non sûr (suffit `CSafeLoader`, données simples) ; `pickle.load` d'un intermédiaire de build non authentifié ; `modules.json` désigne des `.pyd` non confinés qui remplacent des modules natifs ; la sonde lit `candidates.json` dans `%TEMP%` (repli `"."`) ; crawl récursif suivant des liens du HTML récupéré, sans plafond de corps ; sous-processus sans délai et `Popen(PIPE, PIPE)` jamais vidé pour `llama-server` (se fige vers 64 Kio), chemins par défaut `*.exe` (Windows seulement) | [V] |

## 4. Détails

### 4.1 Ponts natifs (axe 1)

| Pont | Techno | Durée de vie / libération | Chargement | Threads/GIL | Verdict |
|---|---|---|---|---|---|
| `aphrody.aphrody_rust` (10 fonctions) | PyO3 0.29 abi3-py311, maturin 1.14.1 | Pas de pointeur : `&[u8]` empruntés, copies en `Vec` | module Python normal, source vérifiée par hash à la construction | `py.detach` | **correct** |
| `shenron_ffi.py` | ctypes `CDLL` à la main | correct (copie puis `shenron_string_free`) | sans intégrité, sans ABI, chemins obsolètes | GIL relâché, fd 1/2 globaux côté Rust | **mort** + risques latents (PY-07) |
| niepy `_ffi.py` (iecode) | ctypes | `NieBytes` libéré une fois, handle VFS en contexte | `NIE_FFI_PATH` ou `target/{release,debug}` depuis `__file__` **et cwd** | n/a | bon, intégrité absente |
| `credential_store.py` | `WinDLL("advapi32")` | `CredFree` en `finally`, copie du blob avant libération, `buf` vivant pendant `CredWriteW` | système | n/a | correct (Windows non exécuté) |
| `sonde_nie_exe.py` | `WinDLL(nie.exe)._handle` + `CFUNCTYPE` | outil RE : indice de reprise écrit avant chaque appel | `NIE_GAME_DIR` | n/a | voulu ; fiabilité par plantage |
| `AgentClient`, `WebBrowserClient` | stdio NDJSON/MCP | enfant reap + join | PATH | threads lecteurs | **correct** |

Encodage : `shenron_ffi.py` encode en UTF-8 et décode strictement ; une NUL dans `query` tronque côté C sans erreur (`c_char_p`) [V].

### 4.2 Désérialisation / exécution dynamique (axe 2)

Intégrité/fiabilité, plus graves d'abord :
1. tools/koharu/model-tools/src/koharu_model_tools/export_dinov2.py:40 — `torch.hub.load` sans référence (PY-03).
2. packages/ai/py/aphrody/aphrody/voice_server.py:114,119 — modèles ONNX/voix téléchargés sans hash (PY-10).
3. packages/iecode/src/iepy/natif/construire.py:234 — archives sans empreinte (extraction `filter="data"` : bon).
4. packages/iecode/src/IEStrikers/common.py:142 — `yaml.load` + `Loader` non sûr (iecode : même ligne en canonique).
5. packages/iecode/src/IEStrikers/calcprogress.py:30 — `pickle.load` d'un intermédiaire (écrit par configure.py:598).
6. packages/iecode/src/iepy/natif/surcharge.py:109-113 — `.pyd` désigné par JSON, non confiné.
7. packages/iecode/src/iepy/natif/sonde_nie_exe.py:38-40,113-130 — candidats lus dans `%TEMP%`.
8. packages/shenron/relecture-ocr/src/relecture_ocr/server.py:165-166 — corps JSON de longueur non bornée.
9. packages/ai/py/aphrody/blender_addon/aphrody_addon.py:402-409 — tampon JSON non borné.
10. packages/ai/py/aphrody/aphrody/forensic/rag.py:246 — `np.load(vec_path)` : `allow_pickle` par défaut à `False` → **sûr**, à garder (listé pour fermer la question).
Importé, conforme : renpy/loadsave.py:636,654 (pickle + signature), renpy/script.py:864,916,1097 (rpyc), renpy/python.py:1140 (`marshal.loads` du cache) — conception amont, non reprochée.
Inventaire neutre (doctrine YOLO) : `exec` aphrody_addon.py:133, inz_cond/gui/controllers/code_controller.py:65, renpy/python.py:1273-1329 ; `shell=True` setup.py:33, google_docs.py:36, iepy/scripts/setuplib.py:421, IEStrikers/configure.py:70 ; `subprocess` : agent.py:133, web_browser.py:46, bpy_runner.py:143, actors.py:116, etc.

### 4.3 Serveurs et clients réseau (axe 3)

| Écoute | Adresse par défaut | Auth | Remarque |
|---|---|---|---|
| Blender add-on (aphrody_addon.py:361-375) | `localhost:9876` TCP | aucune | PY-04 |
| Voix WS (voice_server.py:524) + UI HTTP (:452) | `127.0.0.1:8789/8790`, hôte configurable | aucune, pas d'Origin | PY-05 ; **`aphrody/ui/` ne contient que `__init__.py`** : `index.html` servi par `run_ui_http_server` (l.420-456) n'existe pas dans l'arbre (listing de répertoire à la place) [V] |
| relecture-ocr (server.py:208) | `127.0.0.1:8791` codé en dur | aucune ; confinement de chemin `resolve()` + `is_relative_to` (l.176-183) **bon** | non supervisé (docs/shenron/RUNTIME.md:45), retrait prévu SH-AI-2 (STACK.md:1341) |
| Harnais Antigravity (importé, local_connection.py:1712-1750) | `ws://localhost:<port>` choisi par le harnais | `x-goog-api-key` par session : **bon** | `ANTIGRAVITY_HARNESS_PATH` puis PATH |
| Exemple MCP Antigravity | `0.0.0.0` (examples/resources/mcp_server.py:35) | aucune | importé, exemple |
| smoke-aphrody-stack-local (:183) | `127.0.0.1:33907` | n/a | test |
Clients : `httpx.Client(timeout=…)` partout dans aphrody (30-60 s) ; sans délai : `urlretrieve` (voice, construire), `github/sync.py:52` (importé). Aucun `verify=False`. Secrets : aucun secret committé (grep de motifs : seulement des placeholders) ; l'SDK réutilise le jeton OAuth de l'app Antigravity (`credential_store.py:47-57`, magasin Windows `gemini:antigravity`) : choix d'architecture documenté, à connaître.

### 4.4 Chaîne d'approvisionnement (axe 4)
Voir PY-03, PY-10, PY-11. Points complémentaires : aucun Dependabot/Renovate ni `pip-audit`/OSV dans `.github/` ; `aphrody-ci.yml` délègue à un workflow réutilisable épinglé par SHA (7394f2e5…) ; `torch==2.8.0` épinglé ; les extras sont verrouillés (uv verrouille tous les extras) ; le monorepo garde un second `py/aphrody-train/uv.lock` (83 paquets) et un `.venv` : deux environnements torch concurrents.

### 4.5 Dette de gate
`ruff` : 189 diagnostics ouverts (manifeste, 2026-09-29/30). Aucun jeu bandit (`S`), aucun vérificateur de types sur le code first-party ; seules les règles E/F de base s'appliquent hors `packages/ai/py/**`.

## 5. Matrice de propriété (axe 5)

| Domaine | aphrody-py | aphrody | iecode | Verdict |
|---|---|---|---|---|
| aphrody-train | `packages/ai/py/aphrody-train` (courant : `multimodal_rag`, `__init__` paresseux, `test_multimodal_api`) | `py/aphrody-train` (copie périmée, AST ≠ sur 3 modules, `uv.lock` + `.venv` propres) ; `crates/ai/train` (superviseur Rust) | — | **deux propriétaires** ; docs/ecosystem/ecosystem.json:2253 et :2293 listent les deux ; le skill aphrody-train cite encore `py/aphrody-train` ; le runner utilise la copie aphrody-py |
| relecture-ocr | `packages/shenron/relecture-ocr` (refactor) | `services/shenron/relecture-ocr/serveur.py` (source conservée) | — | double ; retrait prévu au profit de `aphrody-ocr-onnx`/ppocr |
| Générateurs de fixtures embed | `tools/ai/embedding-fixtures` | `crates/ai/embed/tests/fixtures/generate_*.py` | — | différents (155 vs 86 lignes) ; lequel a produit `reference.json` ? |
| Adaptateurs Drive (Spacedrive, FSL-1.1) | `packages/os/drive/adapters` (11 fichiers, modernisés par ruff) | `crates/os/drive/adapters` | — | 11/11 diffèrent ; README de l'import : « changes belong in the OS Drive backend » |
| Sources IECODE | `packages/iecode/src/*` : Buscador 9 fichiers sur 18, IEStrikers 8 sur 579, mapenv 4/4 (1 diffère), inz_cond 47 sur 54 (24 diffèrent) | — | `src/*` canoniques + `src/niepy` | copies partielles divergentes ; `iepy` (Ren'Py, 248 fichiers, `natif/`) n'existe **que** dans aphrody-py |
| niepy | supprimé (49a8871) | — | `src/niepy` | docs/migration/python-import-manifest.json (104 occurrences) et source-map.json (62) citent encore `packages/nie` |
| Module natif `aphrody_rust` | wheel depuis tarball épinglé | `crates/ai/rag-python` + install d'un `libaphrody_rust.so` (630 Ko, `PyInit_aphrody_rust`) dans `~/.local/lib/aphrody/installed-20261001/release` | — | même source, deux constructions (pyo3 0.29.0 vs 0.29.2) |

## 6. Natif first-party vs enrobage (axe 6)

- **Natif first-party (Rust)** : noyau vectoriel RAG (`aphrody-rag-core` via PyO3), superviseur d'entraînement (`aphrody-train`), OCR ONNX (`ocr-onnx`), voix (`voice`), embeddings (`embed`), inférence (`infer`, `llama-server`), traduction, vision.
- **Python = enrobage d'un outil externe** : `relecture-ocr` (RapidOCR/onnxruntime), `voice_server` (faster-whisper + kokoro-onnx via classes du SDK Google), `docling_extractor` et `harmony_reasoning` (llama.cpp en sous-processus), `media`/`icons`/`optimize` (ffmpeg, resvg, pyoxipng), `blender`/`bpy_runner` (Blender), `forensic` (lief, markitdown, magika, fastembed), `agent`/`web_browser` (clients du binaire Rust).
- **Python légitime, sans équivalent Rust** : fine-tuning (sentence-transformers, peft, trl, torch) ; orchestration RAPTOR (`rag/raptor.py`, 851 lignes : le Rust ne fournit que les noyaux vectoriels) ; exports de modèles Koharu.
- Le seul vrai pont natif vers Python est `aphrody_rust` ; le « SDK uv » du noyau n'existe pas (PY-06).

## 7. Briques à réutiliser (« à évaluer »)

| Besoin | Brique | Licence déclarée | Présent ? |
|---|---|---|---|
| Remplacer `shenron_ffi.py` | un module **PyO3** de plus (même recette maturin + `source.json` que `aphrody_rust`), ou le patron stdio `AgentClient`→`aphrody app-server` | pyo3 Apache-2.0/MIT | pyo3 0.29.2 dans Cargo.lock ; maturin 1.14.1 déjà épinglé ; **pas** de `cbindgen`/`uniffi` dans Cargo.lock |
| Déclarations C | générer depuis `aphrody.h` (cbindgen, MPL-2.0) plutôt que ctypes à la main ; `cffi` (MIT) en mode ABI | — | `cffi 2.1.1` dans uv.lock ; cbindgen absent |
| Pickle → safetensors | `safetensors` (Apache-2.0) | — | uv.lock 0.8.0 et Cargo.lock 0.8.0 |
| Téléchargements vérifiés | patron `fetch-moltenvk.py` / `package-appimage.py` (iecode), ou `huggingface-hub` avec `revision=<sha>` (déjà `generate_reference.py` épingle ses révisions) | — | `huggingface-hub 0.36.2` dans uv.lock ; `hf-hub 0.5.0` dans Cargo.lock |
| Binaires de dev | `cargo binstall` avec `--version` épinglé par paquet, ou `mise`/`cargo-dist` | — | — |
| Exports de modèles | `optimum-onnx 0.1.0`, `onnx 1.23.0` (déjà verrouillés) ; Rust : `ort 2.0.0-rc.12`, `candle-core 0.11.0`, `tokenizers 0.22.2` | Apache-2.0/MIT | dans les locks |
| Ruff `S` + type | règles bandit de ruff (déjà `ruff 0.16.9`), `pyright` | MIT | ruff présent |

## 8. Recommandations priorisées

1. **Secrets** (PY-01) : `.gitignore` d'aphrody-py avec `var/`, `.env`, `*-key.json` ; `_paths.secrets_dir()` ne doit plus dépendre du cwd (défaut `~/.aphrody/secrets`, mode 0700, `APHRODY_SECRETS_DIR` explicite) ; `setup_secrets` : jamais d'écrasement de `.env` sans sauvegarde.
2. **Corriger la fiabilité de `aphrody setup`** (PY-02) : passer la liste sans `shell=True` (résoudre `gcloud.cmd` via `shutil.which` sous Windows) et ajouter un test qui n'est pas un mock de `subprocess.run`.
3. **Épingler les entrées de modèles et d'outils** (PY-03, PY-10) : `torch.hub.load("facebookresearch/dinov2:<sha>", …, trust_repo=True)` ou charger via `huggingface-hub` avec `revision=<sha>` ; factoriser un `fetch_verified()` (sha256 + délai + `os.replace`) calqué sur iecode/scripts/ruzu ; épingler les 25 paquets de `developer-cli-tools.json`.
4. **Authentifier les listeners locaux** (PY-04, PY-05) : jeton + contrôle d'Origin, ou socket Unix 0600 / pipe nommé comme le noyau ; borner `Content-Length` et les tampons ; accepter plusieurs clients ; publier `ui/index.html` ou retirer l'option `ui`.
5. **Résoudre la propriété** (PY-08, PY-09, PY-12) : un seul `aphrody-train` (supprimer ou geler `aphrody/py/aphrody-train`), `uv run --locked` + `kill_on_drop` + confinement des artefacts dans `runner.rs`, remplacer les 8 symlinks du monorepo par de vraies entrées ou un wrapper qui échoue proprement, régénérer le manifeste sans `packages/nie`, et supprimer ou brancher `shenron_ffi.py` (PY-07) ; décider si le « SDK uv » du noyau (PY-06) est un client UDS authentifié — c'est le seul pont qui manque réellement.
(Secondaire : retirer la source git `langextract` ou la figer par `rev` et relancer `uv lock` (PY-11) ; activer ruff `S` ; borner les cas `width == 0` du pont PyO3 (PY-13).)

## 9. NON EXAMINÉ

- Exécution : aucun test, aucun `uv lock --check`, aucune construction ; le comportement de `uv` face à la source git inopérante (PY-11) n'est établi que par le lock et le venv, pas par uv.
- Windows/macOS : `credential_store.py` (WinDLL), `sonde_nie_exe.py`, `icons.py` `attrib` — lus, non vérifiés.
- Contenu interne du SDK Antigravity (hooks, mcp, tools : ~35 k lignes importées) hors `local_connection.py` ; Ren'Py hors sites ciblés ; `iecode-cpp/third_party` (210 `.py`, tiers).
- `gemini_web.py` (854 l.), `images.py`, `icons.py`, `google_drive.py`, `batch.py`, `anim.py`, `to3d.py`, `rag/{raptor,graph_extractor,layout_chunker}.py`, `forensic/*` (hors `rag.py:246` et `inventory.py:403`) : grep seulement.
- Les 11 adaptateurs Drive (tokens Gmail/Slack/GitHub) : différences lues, pas l'audit des flux.
- `kokoro-onnx`/`faster-whisper` (absents du venv) : appariement modèle/voix (PY-10) et chargement de `voices.bin` non vérifiés.
- Cohérence `iecode/uv.lock` et `aphrody/py/aphrody-train/uv.lock` ; alertes de sécurité (CVE) des 266 paquets (pas d'accès réseau).
- `scripts/tools/msvc-wsl.py`, `tools/ui/scripts/process_assets.py`, `tools/ai/scripts/{run-*,test-*}.py`, `crates/os/drive/patches/**` : non lus.
- `docs/migration/source-map.json` : seul le décompte de `packages/nie` a été fait.
