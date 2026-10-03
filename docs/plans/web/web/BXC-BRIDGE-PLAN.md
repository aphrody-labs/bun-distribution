# Plan bxc-bridge — ce que aphrody web doit garantir à un appelant Rust

**Date** : 7 septembre 2026 · **Aphrody Web mesuré** : 0.9.4 (binaire), `rust-bridge` 0.2.1
**Appelant** : `crates/web/web-bridge` (à l'époque dans le monorepo aphrody ; aujourd'hui dans
`aphrody-web`, consommé par `aphrody-ai` via `../crates/web/web-bridge`)
**Registre** : ce document prolonge [`RAPPORT-DEFAUTS-2026-09-05.md`](../../../operations/workspace/HISTORY.md)
et son fil rouge — *Aphrody Web échoue en silence avec un code de sortie 0*. Tout ce qui suit
a été mesuré par exécution, avec son code de sortie.

---

## 0. Pourquoi ce plan existe

aphrody vient de retirer `https://r.jina.ai/` de sa surface de lecture web : chaque page
que le modèle demandait était proxifiée par un tiers qui voyait l'URL, l'IP et le timing,
sans timeout, sans user-agent, sans plafond de taille et **sans contrôle de statut** — un
402 ou un 429 du proxy arrivait au modèle comme si c'était la page.

Le remplaçant est Aphrody Web, par deux coutures :

| Couture | Artefact | Pour quoi |
|---|---|---|
| **cdylib en process** | `bxc_rust_bridge.dll` / `.so` | calcul pur sur des octets déjà en mémoire : HTML→Markdown, sélecteurs CSS, titre, DNS |
| **sous-processus** | `aphrody web` (standalone Bun, 130 Mo) | navigateur, stealth, cache, orchestration |

Le choix n'est pas libre. Il est **imposé par l'ABI**, et la section 1 dit pourquoi.

---

## 1. La contrainte qui décide de tout : deux CRT

Mesuré via `llvm-readobj --coff-imports bxc_rust_bridge.dll` :

```
VCRUNTIME140.dll, api-ms-win-crt-{runtime,math,time,heap,utility,string}-l1-1-0.dll
```

La bibliothèque est **`/MD`** (CRT dynamique). aphrody force `-C target-feature=+crt-static`
sur MSVC. Deux CRT dans un process ⇒ **tout `free()` croisé est un comportement
indéfini**.

Conséquences, non négociables :

1. **Chargement au runtime** (`libloading`), jamais de lien statique via une `.lib`
   d'import. C'est exactement le montage `load-dynamic` déjà imposé à ONNX Runtime, pour
   la même raison.
2. **Une chaîne allouée par la bibliothèque n'est libérée que par la bibliothèque.**
   `aphrody_free_string`, jamais l'allocateur de l'appelant (aphrody est sous mimalloc).
3. **Jamais de dépendance Cargo `path`** d'aphrody vers `rust-bridge/crates/*` : cela
   soude deux lockfiles, tire `deno_core`/V8 dès qu'un chemin touche `obscura-js`, et fige
   un build à évolution rapide dans le nôtre.

> **Pour bxc** : si un jour `rust-bridge` est construit en `/MT`, cette contrainte tombe et
> le lien statique redevient possible. Ce n'est pas demandé — le chargement runtime marche
> et découple les cycles de release. Mais **le mode CRT doit être documenté** dans le
> `Cargo.toml` de `rust-bridge`, parce qu'un changement silencieux casserait l'appelant
> sans message.

---

## 2. Le cdylib — 17 symboles, deux durées de vie, aucun garde-fou

### 2.1 Ce qui est exporté (mesuré, `llvm-readobj --coff-exports`)

```
aphrody_dns_recon             aphrody_html_to_markdown      aphrody_x_community_by_rest_id
aphrody_extract_title         aphrody_parse_html            aphrody_x_community_info_and_tweets
aphrody_free_string           aphrody_query_selector        aphrody_x_community_tweets
aphrody_gemini_web_ask        aphrody_query_selector_all    aphrody_x_user_by_screen_name
aphrody_get_chromium_cookies  aphrody_strip_tags            aphrody_x_user_tweets
aphrody_tree_destroy          aphrody_x_algorithm_rank      parse (ordinal 18)
```

### 2.2 Trois défauts ouverts, par gravité

#### D1 — Aucun `catch_unwind` : un panic traverse `extern "C"`

`rust-bridge/src/lib.rs` ne protège aucune fonction exportée, et contient des
`.unwrap()` sur `CString::new` (l. 53, 79, 190, 216…). Un octet NUL **interne** dans du
HTML arbitraire suffit à faire paniquer, et un panic qui traverse une frontière
`extern "C"` est un comportement indéfini — pas une erreur récupérable.

Le risque est réel, pas théorique : le HTML du web contient des NUL.

**À faire côté bxc** : envelopper chaque fonction exportée dans
`std::panic::catch_unwind`, et rendre la convention d'erreur du symbole
(`NULL`, `"[]"`, `{"error":…}`) plutôt que dérouler. C'est **le point n°1** de ce plan :
c'est le seul défaut de la liste qui puisse corrompre le process appelant.

*Contournement en place côté aphrody* : les octets NUL sont retirés avant l'appel et
comptés (`scrub_nuls`). Cela réduit la surface, cela ne la ferme pas — l'appelant ne peut
pas garder un `catch_unwind` de l'autre côté de l'ABI.

#### D2 — `query_selector` confond « rien trouvé » et « sélecteur invalide »

`rust-bridge/src/lib.rs:47-53` :

```rust
match tree.query_selector(selector) { Ok(Some(id)) => .., _ => std::ptr::null_mut() }
```

Le bras `_` absorbe `Ok(None)` **et** `Err(_)`. Idem `query_selector_all` (l. 75) qui rend
`CString::new("[]")` sur `Err`.

Mesuré par `ctypes` sur la DLL livrée, arbre `<ul><li class=x>one</li></ul>` :

| sélecteur | `query_selector` | `query_selector_all` |
|---|---|---|
| `li.x` | `<li class="x">one</li>` | `["<li class=\"x\">one</li>"]` |
| `!!!bad(((` | `NULL` | `[]` |
| `table.absent` | `NULL` | `[]` |

Un sélecteur **cassé** et un sélecteur **sans correspondance** sont bit pour bit
indiscernables. L'appelant conclut « la page ne contient pas cet élément » alors que sa
requête n'a jamais été évaluée. C'est le mode d'échec nommé au §7 du CLAUDE.md d'aphrody :
rien n'est levé, rien n'est journalisé, des résultats disparaissent.

**À faire côté bxc** : distinguer les deux. Le moyen le moins coûteux qui ne change aucune
signature — rendre `NULL` pour « pas de correspondance » et une sentinelle distincte pour
« sélecteur invalide » (par exemple `{"error":"invalid selector"}` sur
`query_selector_all`, cohérent avec la convention déjà utilisée par les symboles réseau).

#### D3 — Aucun symbole de version, et un `*mut DomTree` opaque

`aphrody_parse_html` rend un pointeur dont la disposition vient d'`obscura_dom`, crate interne
non versionné publiquement. Une recompilation de aphrody web peut changer la structure **sans
changer la signature C** : l'appelant charge une DLL dont le contrat a bougé, et rien ne le
lui dit.

Le symbole `parse` (ordinal 18), non préfixé, vient d'une dépendance transitive et pollue
l'espace de noms — collision probable si une autre DLL de ce process exporte `parse`.

**À faire côté bxc** :
- exporter `aphrody_bridge_abi_version() -> u32`, incrémenté à chaque changement de disposition
  ou de convention. L'appelant refuse alors une DLL trop récente au lieu de la
  déréférencer ;
- ne pas exporter `parse` (préfixer ou masquer le symbole transitif).

#### D8 — `cargo clippy` ne passe pas sur `rust-bridge`

Mesuré le 2026-09-07, arbre propre (`git status` vide, donc préexistant) :

```
env -u CARGO_TARGET_DIR cargo clippy --manifest-path rust-bridge/Cargo.toml --all-targets
→ EXIT=101 — 24 erreurs, toutes identiques :
  error: this public function might dereference a raw pointer but is not marked `unsafe`
  --> src/lib.rs:14:41, 30:31, 40:27, 41:41, 62:27, …
```

`clippy::not_unsafe_ptr_arg_deref` appartient au groupe **correctness**, refusé
par défaut : ce n'est pas un réglage local qu'on pourrait assouplir, c'est le
comportement de clippy hors de toute configuration. Le crate n'a donc **aucune
porte clippy verte** aujourd'hui.

Le lint dit exactement ce que dit [D1](#d1--aucun-catch_unwind--un-panic-traverse-extern-c)
sous un autre angle : ces fonctions déréférencent des pointeurs bruts fournis par
l'appelant, donc leur correction dépend d'invariants que seul l'appelant peut
garantir. Le remède est une signature honnête — `pub unsafe extern "C" fn` — qui
**ne change pas l'ABI C** (le symbole exporté est identique) et n'affecte que les
appelants Rust, qui devront écrire `unsafe { … }`. Côté aphrody c'est déjà le cas :
`bxc-bridge` est `#![deny(unsafe_code)]` avec une exemption unique sur son module
`ffi`, et chaque appel y est déjà dans un bloc `unsafe` commenté.

À faire côté Aphrody Web : marquer les 17 fonctions exportées `unsafe`, puis ajouter la
commande ci-dessus au CI. Tant qu'elle n'y est pas, rien ne garde ce crate.

### 2.3 Ce qui est déjà correct — à ne pas casser

La propriété mémoire est **saine et cohérente** : chaque `*mut c_char` vient de
`CString::into_raw` et se rend à `aphrody_free_string` (`from_raw`, l. 80-87) ; chaque
`*mut DomTree` se rend à `aphrody_tree_destroy` (`Box::from_raw`, l. 25-32) ; les `*const
c_char` d'entrée restent la propriété de l'appelant. C'est ce qui a permis un binding
`#![deny(unsafe_code)]` côté aphrody avec une seule exemption de module.

Une asymétrie à conserver documentée : `aphrody_gemini_web_ask` accepte un `model` NULL
(optionnel) alors que tous les autres traitent NULL comme une erreur.

---

## 3. Le binaire — un seul contrat d'exit fiable

### 3.1 Mesures

| invocation | exit | observé |
|---|---|---|
| `aphrody web --version` | **0** | `Aphrody Web 0.9.4` |
| `recon <url> --profile static` | **0** | rapport Markdown complet, 31 s à froid |
| `recon <domaine mort>` | **65** | lignes de progression seulement |
| `scrape <url> --markdown` | **jamais** | page écrite, puis suspension |
| `search <q> --json` | 0 / **65** | JSON dans les deux cas |
| `<sous-commande> --help` | **1** | aide sur stdout |

### 3.2 D4 — `aphrody web scrape` ne rend jamais la main — **le défaut bloquant**

```
bun src/cli/index.ts scrape https://example.com --markdown --profile static
→ EXIT=124 sous timeout 300   (177 octets déjà écrits sur stdout)
```

Le Markdown est produit **correctement**, puis le processus reste suspendu. Mesuré à
300 s, depuis la source comme depuis le binaire.

**Cause racine : NON ÉTABLIE.** Voici ce qui a été éliminé, pour ne pas le refaire :

- **Le client Redis global de Bun** (`import { redis } from "bun"`, `crawl-utils.ts:19`).
  Hypothèse plausible — il garde un socket et un timer de reconnexion. Un `redis.close()`
  ajouté dans le `finally` de `scrape.ts` **n'a rien changé** : toujours EXIT=124. Patch
  retiré (laisser un correctif dont l'effet n'est pas démontré est pire que pas de
  correctif).
- **`Browser.close()`** (`src/api/browser.ts:1558`) : mesuré isolément, il **résout
  instantanément** et laisse `process.getActiveResourcesInfo()` à `[]`.
- **`Target.closeTarget` non géré par le transport statique** : faux, il est déclaré
  (`StaticDomTransport.ts:34`).
- **`scrape.ts::main()` appelée directement** : rend la main, le process sort en 0.

**Le fait qui reste à expliquer** : la même fonction sort proprement en appel direct et ne
sort pas via le routeur `src/cli/index.ts`. La différence n'est pas dans les arguments
(`remaining.slice(1)` identique des deux côtés). **C'est là qu'il faut reprendre.**

*Note de méthode, pour ne pas répéter l'erreur* : une première tentative de dump des
handles a placé la copie instrumentée d'`index.ts` **à la racine du dépôt**, où ses imports
relatifs (`./scrape.ts`) ne résolvent pas. Le script sortait en 1 sans rien afficher, ce
qui ressemblait à un résultat. Toute copie instrumentée doit rester dans `src/cli/`.

**Défaut connexe, non corrigé** : `src/internal/cdp-call.ts` documente que l'appel
« rejette si le transport se ferme avant la réponse ». **Aucun chemin de rejet n'existe
dans le code**, ni timeout. Un transport qui ne répond jamais laisse la promesse non réglée
pour toujours. Ce n'est pas la cause de D4 (mesuré), mais c'est un piège armé pour le
prochain appelant.

### 3.3 D5 — `recon` sort 0 sans avoir produit de rapport

Sur une origine en échec, `recon` escalade seul les cinq profils et n'écrit que ses lignes
`[recon] Probing target using profile: X`. Une fois ces lignes retirées, il ne reste
**rien** — sous un code de sortie 0. C'est le fil rouge du rapport du 5 septembre, encore
vivant.

*Contournement en place côté aphrody* : un corps vide sous exit 0 est transformé en erreur.
Mais c'est l'appelant qui répare le contrat du fournisseur.

### 3.4 D6 — Le profil demandé n'est pas respecté en cas d'échec

`--profile static` sur un domaine mort déclenche `static → http → fast → stealth → max` :
cinq tentatives, coût maximal, alors que l'appelant avait précisément demandé le profil le
moins cher pour **borner** son coût.

**À faire côté bxc** : un drapeau `--no-escalate` (ou faire de l'escalade un opt-in).
L'appelant qui nomme un profil a une raison de le nommer.

### 3.5 D7 — stderr n'est pas exploitable

`scrape` y déverse des extraits de code source Bun sur erreur Redis
(`[smartFetch] Failed to update Redis cache: 185 | …`). stdout de `recon` est préfixé d'une
ligne non-Markdown `[recon] …` que tout parseur doit retirer.

**À faire côté bxc** : réserver stdout au contenu et stderr aux diagnostics **structurés**
(une ligne, un niveau, un message — pas un extrait de source).

---

## 4. Feuille de route

### Phase 1 — Sûreté (bloquant pour toute montée en charge)
0. **D8** marquer les 17 fonctions exportées `unsafe extern "C"` et brancher
   `cargo clippy` sur `rust-bridge` dans le CI. *À faire en premier : c'est
   mécanique, sans effet sur l'ABI, et cela rend la porte utilisable pour tout
   le reste de cette liste.*
1. **D1** `catch_unwind` sur les 17 symboles exportés. *Le seul défaut qui peut corrompre
   le process appelant.*
2. **D3** `aphrody_bridge_abi_version()` + retrait du symbole `parse`.

### Phase 2 — Honnêteté des sorties (le fil rouge)
3. **D4** trouver et corriger le hang de `scrape`. Reprendre à la différence
   routeur/appel direct.
4. **D5** `recon` doit sortir non-zéro quand il n'a pas produit de rapport.
5. **D2** distinguer sélecteur invalide et absence de correspondance.

### Phase 3 — Contrôle par l'appelant
6. **D6** `--no-escalate`.
7. **D7** stderr structuré, stdout propre.

### Phase 4 — Contrat vérifié en continu
8. Un test de contrat dans le CI de aphrody web qui **exécute** le binaire et la bibliothèque et
   vérifie les codes de sortie du tableau §3.1. Aujourd'hui rien ne garde ce contrat : il a
   été découvert par mesure côté appelant, ce qui est le mauvais sens.
9. Documenter le mode CRT de `rust-bridge` (§1).

---

## 5. Ce que l'appelant fait déjà, et qu'il ne faut pas dupliquer

`crates/web/web-bridge` côté aphrody encaisse déjà les défauts ci-dessus. Corriger côté Aphrody Web
permettra de **retirer** ces contournements, pas de les doubler :

| Défaut | Contournement côté aphrody |
|---|---|
| D1 | `scrub_nuls` retire et compte les NUL avant l'ABI |
| D2 | l'ambiguïté est documentée à l'endroit où un appelant la lira |
| D4 | tout enfant est borné par un budget et **tué** ; la sortie déjà émise est conservée et signalée comme tronquée |
| D5 | corps vide sous exit 0 ⇒ erreur typée |
| D6 | le profil demandé est reporté comme *demandé*, pas comme *obtenu* |
| D7 | les lignes `^\[recon\] ` sont retirées et **comptées** |

Règle qui a guidé tout le binding, et qui vaut aussi pour Aphrody Web : **rien ne dégrade en
silence**. Soit l'appel rend une erreur typée qui nomme la commande qui répare, soit il
rend une valeur qui porte le chemin réellement emprunté.

---

## 6. Portes mesurées côté Aphrody Web (2026-09-07)

| Porte | Code |
|---|---|
| `bun run typecheck` (`tsc --noEmit`) | **0** |
| `bun run lint` (oxlint) | **0** — 3 avertissements non bloquants (`profileUsed` et `activeFetches` inutilisés, une échappement superflu dans `mirror.ts:860`) |
| `cargo clippy --manifest-path rust-bridge/Cargo.toml --all-targets` | **101** — voir [D8](#d8--cargo-clippy-ne-passe-pas-sur-rust-bridge) |

Les deux portes TypeScript sont vertes. La porte Rust ne l'est pas, et ne l'a
jamais été : c'est D8, et c'est la première chose à corriger.

> `env -u CARGO_TARGET_DIR` est nécessaire sur les postes où aphrody exporte
> `CARGO_TARGET_DIR` : sans lui, un `cargo build` lancé dans Aphrody Web écrit dans le
> `target/` d'aphrody et non dans le sien.
