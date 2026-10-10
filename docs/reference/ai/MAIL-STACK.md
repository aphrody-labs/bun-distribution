<!-- SPDX-License-Identifier: Apache-2.0 -->
# Messagerie Aphrody

> Historical source references (2026-10-07): links to removed modules use verified Git revisions. These records do not establish a current CLI route or installed capability.

## État vérifié

`contact@aphrody.com` est l'identité d'envoi et de réception prévue. La zone
publique utilise actuellement OVH Mail :

- MX : `mx0.mail.ovh.net` (priorité 1), `mx1.mail.ovh.net` (5),
  `mx2.mail.ovh.net` (50), `mx3.mail.ovh.net` (100) ;
- SPF : `v=spf1 include:mx.ovh.com ~all` ;
- DMARC : `v=DMARC1; p=none; adkim=s; aspf=s` ;
- SMTP : `ssl0.ovh.net:465` (TLS implicite) ou `:587` (STARTTLS) ;
- IMAP : `ssl0.ovh.net:993` (TLS implicite).

Les ports SMTP et IMAP ont été vérifiés joignables depuis le VPS. Cela ne
prouve pas que la boîte existe : l'API utilisée par `ovhcloud` refuse les
surfaces Email Domain, MX Plan et Email Pro avec `403 This call has not been
granted`. La création et le test authentifié de la boîte restent donc bloqués.

Le Manager OVH vérifié le 7 septembre 2026 confirme un état distinct : le
service du domaine est actif, mais l'offre est `redirect` et le quota de
comptes est `0 / 0`. Il n'y a donc actuellement aucune boîte OVH à tester ;
une offre disposant d'un quota de comptes doit être attachée au domaine avant
toute création de `contact@aphrody.com`.

## Secrets d'exécution

Ne jamais versionner le mot de passe de la boîte. Le service consommateur doit
charger un fichier d'environnement détenu par son utilisateur, mode `0600` :

```dotenv
MAIL_PROVIDER=auto
MAIL_FROM="Aphrody <contact@aphrody.com>"
RESEND_API_KEY=
RESEND_API_BASE_URL=https://api.resend.com
SMTP_HOST=ssl0.ovh.net
SMTP_PORT=465
SMTP_TLS=implicit
SMTP_USER=contact@aphrody.com
SMTP_PASSWORD=
# Reserved for the future inbound collector; no IMAP password is provisioned.
IMAP_HOST=ssl0.ovh.net
IMAP_PORT=993
IMAP_TLS=implicit
IMAP_USER=contact@aphrody.com
IMAP_PASSWORD=
```

`MAIL_PROVIDER=auto` choisit Resend si `RESEND_API_KEY` est présente, sinon
OVH SMTP. La sélection est faite au démarrage et une erreur Resend n'est pas
rejouée automatiquement via SMTP, afin d'éviter les doubles envois. Pour
forcer OVH, utiliser `MAIL_PROVIDER=smtp` et `SMTP_TLS=implicit` (465) ou
`SMTP_TLS=starttls` (587). `RESEND_API_BASE_URL` est réservé aux tests et aux
proxies explicitement maîtrisés.

Le service systemd du site (modèle retiré le 2026-10-04, voir `tools/config/service-catalog.json`)
charge `/etc/aphrody/aphrody-site.env` lorsqu'il existe. Aucun modèle `.env`
n'est suivi dans les dépôts ; provisionner le fichier réel hors Git avec des
permissions `0600`.

Le mot de passe fourni à l'opérateur ne doit être injecté qu'après confirmation
de l'existence de la boîte. Aucun secret mail n'est présent dans le dépôt. La
clé Resend de production est conservée uniquement dans
`/etc/aphrody/aphrody-site.env` sur le VPS, en `0600` root:root.

## Better Auth

Better Auth ne transporte pas lui-même les messages. Les callbacks
`sendVerificationEmail` et `sendResetPassword` appellent un adaptateur mail
unique, alimenté par les variables ci-dessus. L'envoi doit être attendu hors de
la transaction HTTP ou placé dans une file persistante, sans journaliser
l'adresse, le lien ou le jeton.

```ts
export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await mail.sendPasswordReset({ to: user.email, url });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await mail.sendVerification({ to: user.email, url });
    },
  },
});
```

Exigences communes aux vitrines Aphrody, BXC, Niers et N2B : URL Better Auth
propre à chaque origine, secrets de session distincts, même adaptateur mail,
liens HTTPS absolus, expiration courte, usage unique et limitation de débit par
compte et par adresse IP.

## Resend

Resend est configuré comme fournisseur d'envoi transactionnel, pas comme
réception principale. Le domaine `aphrody.com` a été ajouté au compte Resend
(région EU), et ses deux CNAME SPF ainsi que son TXT DKIM sont publiés dans la
zone OVH. Resend doit encore passer l'état `Pending` après propagation DNS;
les MX OVH restent en place pour la réception.

Le connecteur Rust est [`aphrody-messaging::ResendConnector`](https://github.com/aphrody-labs/aphrody/blob/4d258700316af92c6f358902c60df130d8f60edf/crates/ai/messaging/src/resend.rs).
La commande opérateur est `aphrody mail health` (lecture seule), puis
`aphrody mail send --to ... --subject ... --message ...` pour un envoi explicite.
Passer `--idempotency-key` pour rendre une relance sûre côté Resend ; la clé
doit être stable pour le même événement métier et unique entre événements.
Une clé Resend limitée à `Sending access` ne peut pas lire `/domains` ; le
connecteur traite cette restriction attendue comme une santé de configuration,
sans envoyer de message. L'envoi réel reste à tester avec un destinataire
explicitement choisi.

## Validation de mise en production

1. Créer ou confirmer la boîte `contact@aphrody.com` dans OVH Manager/API.
2. Tester l'authentification IMAP 993 et SMTP 465 sans afficher le secret.
3. Envoyer un message vers une boîte externe et vérifier SPF, DKIM et DMARC.
4. Répondre vers `contact@aphrody.com` et confirmer la réception IMAP.
5. Tester les parcours Better Auth de vérification et de réinitialisation.
6. Passer DMARC de `p=none` à `quarantine`, puis `reject`, après observation.

