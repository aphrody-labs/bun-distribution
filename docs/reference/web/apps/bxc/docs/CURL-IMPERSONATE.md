# curl-impersonate dans BXC

## Contrat de production

BXC charge `libcurl-impersonate` directement avec `bun:ffi`. Aucun binaire curl,
shell, Node ou subprocess n'est requis pour les requêtes. Le client applique
`curl_easy_impersonate()` avant chaque transfert et expose une `Response` Web.

```ts
import { ImpersonatedClient } from "@aphrody/bxc/ffi/curl-impersonate";

const client = new ImpersonatedClient({
  profile: "chrome146",
  httpVersion: "3.0",
  timeoutMs: 30_000,
  maxConnections: 32,
  followRedirects: true,
});

const response = await client.fetch("https://example.com", {
  method: "GET",
  headers: { accept: "text/html" },
});
const html = await response.text();
client.close();
```

`NativeHttpClient` fournit une façade unique avec deux backends :

- `mode: "curl-impersonate"` : empreinte TLS/HTTP navigateur et profils Chrome,
  Firefox, Safari et Edge ;
- `mode: "obscura"` : transport Rust Obscura ;
- `mode: "auto"` : curl-impersonate si la bibliothèque est disponible, sinon
  Obscura.

## Capacités exposées

Toutes les options de la liaison locale sont conservées : profils d'empreinte,
headers, méthode et body, cookies en mémoire, cookie jar persistant,
redirections et limite de redirections, timeout global et connexion, proxy et
authentification proxy, authentification serveur, CA personnalisé, vérification
TLS, HTTP/1.0, HTTP/1.1, HTTP/2 et HTTP/3, compression automatique, keep-alive,
limite de connexions, mode hors-thread et logs verbose.

Le téléchargement de fichiers utilise le même `fetch()` puis `Bun.write()` ;
le miroir complet HTML/CSS/JS/images/fonts est fourni par `bxc mirror --profile
wget`, qui réutilise ce transport sans créer un second downloader.

## Profils et empreintes

Les profils sont validés par `curl_easy_impersonate()` au chargement de la
requête. Une erreur de profil ou de bibliothèque remonte sous forme de
`CurlError` avec son code CURL. Ne pas modifier manuellement les options TLS
(`ciphers`, courbes, version TLS, ALPN) après l'impersonation si l'objectif est
de conserver une empreinte navigateur exacte.

## Déploiement cross-platform

Le chargeur cherche le répertoire vendor configuré, le vendor du package, puis
les répertoires natifs de la plateforme :

- Windows x64/ARM64 : `libcurl-impersonate.dll` ;
- macOS x64/ARM64 : `libcurl-impersonate.dylib` ;
- Linux x64/ARM64 : `libcurl-impersonate.so`.

Configurer `BXC_VENDOR_DIR` pour une installation système hermétique et
`BXC_RUST_BRIDGE_LIB` pour la bibliothèque Obscura. Les certificats CA doivent
être présents sur l'hôte ; utiliser `caBundle` uniquement lorsque le chemin
est connu et géré par le déploiement.

Les artefacts upstream supportent Linux, macOS, Windows, Android et iOS ; BXC
valide directement Windows, Linux et macOS selon l'artefact natif disponible.
Le tag de runtime est centralisé dans `src/native/versions.ts`.

## Diagnostic sûr

```ts
import { isLibAvailable } from "@aphrody/bxc/ffi/curl-impersonate";
import { NativeHttpClient } from "@aphrody/bxc/transport/native-http";

console.log({ curlImpersonate: isLibAvailable() });
const client = new NativeHttpClient({ mode: "auto" });
console.log({ backend: client.mode });
client.close();
```

Ne jamais désactiver `sslVerify` en production. Les cookies, proxies et
identifiants sont passés en mémoire ou via un chemin de secret géré par
l'environnement ; ils ne doivent pas être écrits dans les logs ou les commits.
