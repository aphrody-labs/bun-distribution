# Bot Azalée — mise en service

Le serveur Discord **Azalée** (« 𝓐𝔃𝓪𝓵𝓮́𝓮 🌸 », guilde `1349526851672080414`) a
son propre bot. Ce bot **n'a pas de code à lui** : c'est `apps/rg/bot`, le même
programme que le bot Rose Griffon, lancé une seconde fois avec un autre
**profil** et un autre **jeton**.

> Pourquoi ce détour plutôt qu'un second dossier : un correctif appliqué à une
> commande doit valoir pour les deux serveurs sans être écrit deux fois. Une
> copie de `apps/rg/bot` aurait produit deux bases divergentes dès le premier
> correctif appliqué d'un seul côté. Tout ce qui diffère entre les deux bots
> passe donc par la **configuration** — le registre de profils
> (`apps/rg/bot/src/lib/profil.ts`) — et jamais par un fichier dupliqué.

## 1. Le principe : un processus, un profil

Le profil se lit dans la variable d'environnement `RG_PROFIL_BOT` : `rg` par
défaut (le bot Rose Griffon, rien à changer), `azalee` pour ce second bot. Un
profil décide de cinq choses, et de rien d'autre :

| Ce que le profil décide | Profil `rg` | Profil `azalee` |
| --- | --- | --- |
| Jeton lu (donc identité Discord) | `DISCORD_BOT_TOKEN` | `AZALEE_DISCORD_BOT_TOKEN` |
| Portée des commandes | par guilde : RG, Azalée, Achillea | **globale** — tout serveur qui invite le bot |
| Commandes chargées | communauté + `/administration` | données de jeu, archive X, `/staff` |
| Marque des embeds (couleur, pied de page, URL de base) | `#a14b3f`, `rosegriffon.fr`, `WEBSITE_URL` | `#F89C5A`, `azalee.rosegriffon.fr`, `AZALEE_WEBSITE_URL` |
| Salon d'annonce des posts X et nom du curseur | `DISCORD_NEWS_CHANNEL_ID`, curseur `discord` | salon `1349528692086276148` (ou `AZALEE_DISCORD_NEWS_CHANNEL_ID`), curseur `azalee` |

**Pourquoi deux portées différentes.** Le bot Rose Griffon administre *une* communauté
(membres, niveaux, accueil) : ses commandes n'ont aucun sens sur un serveur dont il ne
connaît ni les membres ni les rôles, il reste donc enregistré serveur par serveur. Le bot
Azalée sert le wiki — les mêmes fiches partout, aucune configuration propre à un serveur —
et son application est **publique** (`bot_public: true`). Tant qu'il enregistrait ses
commandes par guilde, un serveur qui l'invitait voyait un bot en ligne et **strictement
muet** : c'est ce qui est arrivé à Achillea le 14/8/2026, absent de la liste codée en dur.
Depuis, ses commandes sont publiées globalement — inviter le bot suffit, sans commit ni
redéploiement.

Deux conséquences à connaître. Discord met quelques minutes à propager une modification
globale, là où une guilde est instantanée. Et surtout, Discord **additionne** les deux
portées : les anciennes commandes de guilde doivent être effacées, sinon chaque commande
apparaît en double sans qu'on puisse dire laquelle répond. Le service le fait au démarrage
(`clearApplicationCommands`) et l'annonce dans son journal.

Chaque profil a ses **propres** variables d'environnement pour la marque et le
salon, et ce n'est pas une coquetterie : les deux services lisent le même
`.env.local`. Si les deux profils écoutaient `WEBSITE_URL`, la ligne
`Environment=WEBSITE_URL=https://rosegriffon.fr` de `rg-bot.service` ferait
pointer les liens du bot Azalée vers le site principal.

Tout le reste est **partagé** : la base Postgres, le cache Redis, l'API Azalée
en boucle locale (`127.0.0.1:8807`), la socket du cron, et l'intégralité de
`src/lib/`. Les deux bots ne partagent **ni leur jeton, ni leur curseur
d'annonce**.

Le salon `1349528692086276148` appartient bien à la guilde Azalée : son flocon
donne le 12/03/2025 à 23 h 45 UTC, sept minutes après la création de la guilde
(23 h 37) — `(id >> 22) + 1420070400000`. Il n'est **pas** dans la table
`discord_channels`, qui ne suit que cinq salons, tous de la guilde Rose Griffon
(vérifié en base) : il ne se lit donc nulle part ailleurs que dans le registre
de profils.

## 2. Créer l'application et le bot

Portail développeur Discord → **New Application** (nom : `Azalée`) → onglet
**Bot**.

1. **Reset Token** : le jeton n'est affiché qu'une fois. Copie-le tout de suite,
   il ira à l'étape 3.
2. **Privileged Gateway Intents** → activer **Server Members Intent**.
   C'est obligatoire, pas optionnel : le client est commun aux deux profils et
   demande `Guilds` + `GuildMembers` (`src/index.ts`, `intents: [Guilds,
   GuildMembers]`). `GuildMembers` est le seul des deux qui soit **privilégié**.
   Sans lui activé, Discord ferme la passerelle au `login` avec le code **4014
   « Disallowed intent(s) »**, `Restart=on-failure` relance, et le service
   boucle sans jamais se connecter.
3. **Message Content Intent** : laisser **désactivé**. Le bot ne lit aucun
   contenu de message — il ne réagit qu'aux interactions.
4. **Public Bot** : à décocher si tu veux être le seul à pouvoir l'inviter.

## 3. Poser le jeton

Le jeton s'appelle `AZALEE_DISCORD_BOT_TOKEN`. Emplacement recommandé, **hors du
dépôt** :

```bash
sudo install -m 600 -o root -g root /dev/null /etc/azalee-bot.env
sudo tee /etc/azalee-bot.env >/dev/null <<'EOF'
AZALEE_DISCORD_BOT_TOKEN=colle-le-jeton-ici
EOF
```

`azalee-bot.service` charge ce fichier en dernier (`EnvironmentFile=-` : son
absence n'empêche pas le démarrage, elle empêche seulement le bot de se
connecter). À défaut, la même variable posée dans `../rg/.env.local`
fait l'affaire — ce fichier est gitignoré (`.gitignore:114`, règle
`.env*.local`), comme l'est tout `*.env` réel (`.gitignore:151`).

**Un jeton ne va jamais dans un fichier suivi par git.** Le dépôt a déjà eu son
historique purgé pour cette raison, et un jeton Discord poussé sur un dépôt
public est révoqué automatiquement par Discord — mais seulement après avoir été
lu par tout le monde. `infra/systemd/azalee-bot.service` est suivi par git : il
nomme la variable, il ne la valorise pas.

Ne réutilise pas `DISCORD_BOT_TOKEN` : c'est le jeton du bot Rose Griffon.
Deux processus sur le même jeton, c'est un même compte connecté deux fois à la
passerelle — chaque annonce serait publiée en double.

## 4. Inviter le bot sur le serveur Azalée

Remplace `<CLIENT_ID>` par l'**Application ID** de la nouvelle application
(onglet General Information) :

```
https://discord.com/oauth2/authorize
  ?client_id=<CLIENT_ID>
  &scope=bot%20applications.commands
  &permissions=52224
  &guild_id=1349526851672080414
  &disable_guild_select=true
```

(à recoller sur une seule ligne)

- `scope=bot applications.commands` : `bot` ajoute le compte au serveur,
  `applications.commands` autorise l'enregistrement des slash commands. Sans le
  second, le bot apparaît en ligne et reste **strictement muet** — aucune
  commande n'existe.
- `guild_id` + `disable_guild_select` : verrouille l'invitation sur la guilde
  Azalée, pour ne pas se tromper de serveur dans la liste déroulante.

### Les permissions, et pourquoi celles-là

`permissions=52224` est la somme de quatre bits, et de quatre seulement
(valeurs lues dans `PermissionFlagsBits` de discord.js, pas de mémoire) :

| Permission | Nom API | Bit | Pourquoi |
| --- | --- | ---: | --- |
| Voir les salons | `ViewChannel` | 1024 | résoudre le salon d'annonce |
| Envoyer des messages | `SendMessages` | 2048 | publier l'annonce |
| Intégrer des liens | `EmbedLinks` | 16384 | l'annonce est un embed |
| Joindre des fichiers | `AttachFiles` | 32768 | `/cpk fichier` et `/cdn` renvoient de vrais fichiers |
| **Total** | | **52224** | |

Ce n'est pas un choix par défaut recopié : l'annonce des nouveaux posts X est
un **message ordinaire** envoyé dans le salon
(`src/services/tweetsNotifier.ts`, `salon.send({ embeds… })` — le code vérifie
d'ailleurs `isSendable()` et sait dire quand la permission manque). Les fichiers
joints viennent de `src/commands/cpk.ts` (aperçu et modèle `.glb`) et de
`src/commands/cdn.ts` (`AttachmentBuilder` + `files: [...]`).

Ce qui n'est **pas** demandé, et ne doit pas l'être : Administrateur (`8`),
gestion des messages, gestion des rôles, mention de `@everyone`, expulsion,
bannissement. Le bot ne modère rien et ne modifie personne.

Une fois l'invitation acceptée, vérifie sur le salon `1349528692086276148`
lui-même que le rôle du bot n'y est pas privé de « Voir le salon » par une
autorisation de salon : la permission accordée au serveur ne survit pas à une
interdiction posée au niveau du salon. C'est le cas déjà rencontré côté Rose
Griffon, et le drain le signale explicitement dans le journal.

## 5. Installer et démarrer le service

```bash
sudo cp ../rg/infra/systemd/azalee-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now azalee-bot.service
```

Le fichier est un calque de `rg-bot.service` : `RG_PROFIL_BOT=azalee`,
`SyslogIdentifier=azalee-bot`, un `EnvironmentFile` supplémentaire pour le
jeton, et **aucune** cible publique posée en dur (le profil porte déjà
`https://azalee.rosegriffon.fr`). Le `WorkingDirectory` reste
`../rg/apps/bot` — le **même** que pour rg-bot : Bun lit le
`tsconfig.json` du répertoire courant, et c'est celui-là qui porte
`experimentalDecorators` + `emitDecoratorMetadata`. Lancé d'ailleurs, discordx
meurt immédiatement sur « TypeError: undefined is not an object (evaluating
'descriptor.value') ».

## 6. Vérifier

```bash
journalctl -u azalee-bot -f
```

Au premier démarrage réussi, on doit lire ces lignes (l'ordre entre les deux
premières dépend de discordx, qui branche ses écouteurs `@Once` au `login`) :

```
✓ Prêt en tant que Azalée#… — 1 serveur(s)
↔ Synchronisation des membres laissée à rg-cron.service (BOT_SYNC_MEMBRES≠1) — ce bot ne sert que les slash commands.
✓ Commandes enregistrées sur 1 serveur(s) : 𝓐𝔃𝓪𝓵𝓮́𝓮 🌸
✓ Logged in as Azalée#…
[tweets] curseur « azalee » créé à …Z — aucun rattrapage de l'archive.
```

La dernière ligne n'apparaît qu'une fois dans la vie du bot : le curseur est
créé à `now()`, donc **rien de l'archive n'est rejoué**. Le premier post
annoncé sera un post publié après ce démarrage.

Ce qui peut clocher, et ce que ça veut dire :

| Journal | Cause |
| --- | --- |
| Le service redémarre en boucle sans « Logged in » | intent `Server Members` non activé (fermeture 4014) — étape 2 |
| `[profil] Jeton Discord absent pour le profil « azalee »…` | jeton absent — étape 3 |
| `[profil] AZALEE_DISCORD_BOT_TOKEN contient un secret SCELLÉ…` | un blob `eyJ2Ijo…` a remplacé le jeton en clair dans l'env |
| `[profil] RG_PROFIL_BOT="…" n'est pas un profil connu` | faute de frappe dans l'unité (`azalée`, `azale`, `Azalee` suivi d'une espace…) ; le service refuse de démarrer plutôt que de lancer un second bot Rose Griffon |
| `⚠ Guilde(s) configurée(s) mais non rejointe(s) : 1349526851672080414` | invitation non faite ou refusée — étape 4 |
| `Salon 1349528692086276148 injoignable` / « le bot ne peut pas y écrire » | permission de salon manquante — fin de l'étape 4 |
| Bot en ligne, aucune commande dans le serveur | `applications.commands` oublié dans l'URL d'invitation |

Côté Discord, `Ctrl+R` rafraîchit la liste des commandes du client : une
commande fraîchement enregistrée peut ne pas apparaître dans une fenêtre
ouverte depuis longtemps.

## 7. Ce que ce bot fait — et ne fait pas

**Il fait** — tout ce qui parle du JEU et de son exploitation :

- les fiches du wiki IEVR (`/azalee`), les 250 800 fichiers des archives CPK
  (`/cpk`), le CDN et ses modèles 3D (`/cdn`), la recherche sémantique du
  corpus (`/rag`) et l'archive des posts X (`/x`) ;
- la racine `/staff`, c'est-à-dire la **consultation** d'exploitation (état des
  services, statistiques, veille, web, cron). Elle est gardée par
  `requireRgAdmin` (`src/lib/rbac.ts`), qui résout le rôle en base via la table
  `account` de Better Auth : aucun rôle Discord n'entre dans la décision, la
  garde protège donc identiquement sur un serveur comme sur l'autre ;
- l'annonce des nouveaux posts X dans le salon `1349528692086276148`.

**Il ne fait pas** :

- **aucune synchronisation de membres.** `BOT_SYNC_MEMBRES=0` est posé dans
  l'unité, et il doit y rester : `discord_members` décrit la communauté Rose
  Griffon, la table est alimentée par `rg-cron.service`, et les membres du
  serveur Azalée n'ont rien à y faire. Les gestionnaires
  `guildMemberAdd`/`Update`/`userUpdate` restent inertes dans ce profil.
- **aucune commande communautaire de Rose Griffon** : ni `/agenda`, ni
  `/membre`, ni `/equipe`, ni `/boutique`, ni `/campagne`, ni `/patreon`, ni
  `/sondage`, ni `/article`. Elles décrivent l'association et son serveur ; les
  afficher ailleurs n'aurait pas de sens.
- **aucune écriture** : la racine `/administration` — la seule qui modifie
  vraiment quelque chose — reste au bot Rose Griffon.

La liste exacte des modules chargés est fixée par le registre de profils
(`MODULES_AZALEE` dans `src/lib/profil.ts`) et importée par `src/index.ts` :
c'est **cette** liste qui fait autorité, pas ce paragraphe.

## 8. Le curseur d'annonce, partagé entre les deux bots

La détection des nouveaux posts n'est pas un événement : c'est une **lecture de
base** bornée par un curseur, rangé dans `public.tweet_notification_curseurs`.
La table est clé par `canal` (`text`), et porte aujourd'hui **une seule ligne,
`discord`** — celle du bot Rose Griffon (vérifié en base le 13/08/2026).

Chacun des deux bots annonce **sur son propre serveur**, à deux publics
différents : les deux doivent donc annoncer le même post, chacun une fois. D'où
la règle :

- **un curseur par profil** — `discord` pour Rose Griffon, `azalee`
  pour Azalée. Le second est créé tout seul au premier démarrage
  (`assurerCurseur`, `INSERT … ON CONFLICT (canal) DO NOTHING`), à `now()`.
- **jamais deux processus sur le même curseur.** Ce serait le cas si le profil
  `azalee` réutilisait `discord` : les deux bots draineraient la même ligne, et
  le premier arrivé priverait l'autre de l'annonce (l'avance du curseur se fait
  en échange-comparaison sur sa valeur attendue — c'est précisément ce qui
  protège du doublon **à l'intérieur** d'un profil).
- `rg-cron.service` ne publie toujours **rien** : il signale, le bot draine. Un
  bot arrêté ne perd pas d'annonce, il la publie à son réveil dans la limite de
  la fenêtre de rattrapage.

Corollaire d'exploitation : réinitialiser le curseur d'un bot n'a aucun effet
sur l'autre, et supprimer la ligne `azalee` fait repartir le bot Azalée
en « aucun rattrapage » au prochain démarrage.

## 9. Mettre à jour le code

Les deux services exécutent les **mêmes fichiers** : après une modification de
`apps/bot/src/**`, il faut redémarrer les deux pour que le correctif prenne
partout.

```bash
sudo systemctl restart azalee-bot.service
```

> `rg-bot.service` n'existe plus sur cette machine et `apps/rg/bot` n'y est plus
> déployé : ne pas le réanimer sans demande explicite. La règle ci-dessus vaut
> dès que les deux services coexistent.
