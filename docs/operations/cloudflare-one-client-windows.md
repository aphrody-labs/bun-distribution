<!-- SPDX-License-Identifier: Apache-2.0 -->

# Client Cloudflare One Windows

Propriétaire : Aphrody Infra, `tools/config/host/windows/cloudflare-one-client.ps1`.
Le workspace fourni possède un seul cache MSI :
`install/cache/cloudflare-one/2026.8.2110.0/`. Aucun profil, cookie ou secret n'est copié.

Depuis PowerShell Windows x64 :

```powershell
& tools/config/host/windows/cloudflare-one-client.ps1 -Phase plan -WorkspacePath C:\src\bun-os
& tools/config/host/windows/cloudflare-one-client.ps1 -Phase download -WorkspacePath C:\src\bun-os
& tools/config/host/windows/cloudflare-one-client.ps1 -Phase verify -WorkspacePath C:\src\bun-os
```

Le téléchargement vérifie HTTPS et chaque redirection vers le domaine officiel exact,
la taille annoncée <= 100 MiB et >= 300 MiB libres après téléchargement. Les ancêtres
du cache ne peuvent être des reparse points ; les fichiers étrangers sont refusés.
Le reçu ignoré par Git contient l'identité publique du MSI, sans identité utilisateur.

Observation réelle du 14 octobre 2026 : release `2026.8.2110.0`, ProductVersion MSI
`26.8.2110.0`, plateforme MSI `x64;1033`, 60 100 608 octets, Authenticode `Valid`,
éditeur `Cloudflare, Inc.`, certificat `0B6C68C4BAD79F9AC39E07FE84223FB796D4D0BC`.
SHA256 fixé dans le helper après vérification du téléchargement officiel :
`f4668340028aa209a148b5d0a15846434e2c90ae2596841e9c75fd607cf045a5`.

L'installation exige un véritable token administrateur Windows et une revue préalable
du propriétaire. Elle revalide le MSI et son reçu, refuse un client ou `mdm.xml`
existant et lance exclusivement `msiexec /i <MSI> /qn /norestart ORGANIZATION=aphrody-labs`.
La phase `install` attend au maximum 180 secondes ; un timeout signifie un état
indéterminé à examiner, sans nouvelle tentative automatique ni arrêt du service MSI.
Codes admis : 0 et 3010 (redémarrage requis, jamais effectué par le helper).
Le reçu public `install-receipt.json` conserve le lancement, puis le code MSI avant
le contrôle de santé. Une tentative déjà présente est refusée. `status` et `verify`
revalident sans écrire le MSI/signature/SHA256, le reçu de téléchargement, le service
actuel `CloudflareWARP` Running/Automatic, le binaire signé et sa ProductVersion,
et la version enregistrée du produit. La détection préalable à l'installation
reconnaît `CloudflareWARP`, l'ancien nom `WarpSvc` et le binaire existant.
Le helper ne demande ni enregistrement, ni connexion, ni désenregistrement ; il ne
touche pas au service cloudflared. Organisation configurée ne prouve pas l'enrollment.

Le propriétaire a installé une seule fois le MSI. L'ancien contrôle final cherchait
`WarpSvc` et a déclaré à tort `INSTALL_SERVICE_NOT_OBSERVED`. Après correction,
la vérification native en lecture seule a passé : `CloudflareWARP` Running/Automatic,
ProductVersion binaire `2026.8.2110.0`, registre `26.8.2110.0`, signature Valid,
SHA256 binaire `3e08b2f1644a7879d0a97cc13f489988f8db95534443651d8f1040c7a758ed38`.
La première exécution n'avait pas de reçu MSI persistant : aucun reçu rétrospectif
ni code de sortie supposé n'est généré. Le propriétaire a ensuite lancé l'inscription
CLI ; l'inscription SSO a ensuite terminé de manière asynchrone : managed=true,
organisation `aphrody-labs`. WARP a signalé Connected/unstable, avec échec immédiat
de l'accès privé Source. La déconnexion WARP a rétabli HTTP 200 sur le nom Source.
Le client reste inscrit mais déconnecté ; son routage privé n'est pas qualifié.
Le DNS privé Source et TLS natif ont été qualifiés séparément par le propriétaire ;
cette preuve ne qualifie pas le routage WARP du client installé et inscrit.

Sources primaires : [versions Windows](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/download/)
et [déploiement MSI et paramètres publics](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/mdm-deployment/).
