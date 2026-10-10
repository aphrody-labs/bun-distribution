<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody sur ton PC : le guide d'Omar

Une seule appli : **Aphrody Omar**. Tu fais un double-clic, un menu s'affiche, tu tapes un numéro puis Entrée. Tu n'as jamais besoin de taper une commande.

Quand l'application **Aphrody** est installée sur ton PC, le double-clic sur Aphrody-Omar ouvre directement sa page
**Administration** : les mêmes menus en boutons, et les questions (dont « tape OUI ») dans une fenêtre. Sans
l'application, c'est le menu ci-dessous, comme avant. Pour retrouver le menu même avec l'application : lance
`Aphrody-Omar.exe --console`.

## La première fois

1. Décompresse le dossier reçu de l'équipe (clic droit, **Extraire tout**) et double-clique **Aphrody-Omar.exe**.
   Si Windows affiche « Windows a protégé votre ordinateur » : **Informations complémentaires**, puis **Exécuter quand même** (le programme n'est pas encore signé).
2. Tape **1** (Tout installer ou réparer), puis Entrée. Quand Windows demande l'autorisation, clique **Oui**.
   Quand la fenêtre GitHub s'ouvre, connecte-toi avec le compte invité dans l'organisation aphrody-labs. Le téléchargement du dépôt peut durer plusieurs minutes.
3. Le programme dit « en attente du fichier d'accès » : c'est normal la première fois. Il a mis **a-envoyer-a-l-equipe.txt** sur ton Bureau (et dans le presse-papiers) : envoie ce texte à l'équipe. Il ne contient que des clés publiques.
4. L'équipe te renvoie **aphrody-omar-acces.json**. Mets-le dans **Téléchargements**.
5. Retape **1** (tu peux le refaire autant de fois que tu veux, sans risque). Cette fois le tunnel privé et SSH s'installent.
6. Tape **2** (Vérifier que tout est prêt). Tu dois lire **TOUT EST PRÊT**. Avec **PRESQUE PRÊT**, rien ne bloque : lis seulement les lignes `[!]`.

## Entraîner un modèle (menu 3)

- **1** Voir l'état : ce qui tourne, ce qui est fini ou échoué.
- **2** Lancer : choisis le type (commence par **Test**), réponds aux questions. Le programme montre d'abord ce qu'il ferait. Rien ne part tant que tu n'as pas tapé **OUI** en majuscules.
  Ensuite tu peux fermer la fenêtre : le travail continue sur le serveur.
- **3** Journal : les dernières lignes du dernier entraînement.
- **4** Arrêter : arrêt propre d'un travail en cours, confirmation **OUI** demandée.

Garde-fous : rien n'est supprimé ni écrasé, un seul entraînement à la fois, aucun modèle n'est mis en service tout seul. Un entraînement réserve la carte graphique : les modèles d'inférence du serveur sont suspendus le temps du travail.

## Mon PC et mes serveurs (menu 7)

Des boutons pour l'état du PC, WSL, libérer de la mémoire (sans supprimer de fichier, confirmation **OUI**), le diagnostic d'aphrody, mes modèles, yolo et la santé des serveurs. Ils utilisent aphrody et yolo : il faut qu'ils soient installés (menu 1).

## Si ça bloque

| Tu vois | Tu fais |
| :-- | :-- |
| « en attente du fichier d'accès » | Normal tant que l'équipe n'a pas répondu. Vérifie le nom du fichier dans Téléchargements, puis retape 1. |
| « Tunnel privé : arrêté » ou « pas installé » | Tape 1 et clique **Oui** dans la fenêtre Windows. Sinon ouvre l'appli WireGuard et clique **Activer**. |
| « le serveur refuse ta clé » | Ta clé n'est pas encore ajoutée côté serveur : tape 4 et renvoie le texte à l'équipe. |
| « l'empreinte du serveur ne correspond pas » | Ne continue pas : préviens l'équipe. |
| La connexion GitHub échoue | Accepte l'invitation à aphrody-labs (mail de GitHub), puis retape 1. |
| « pas encore publié pour Windows » | Rien à faire : l'équipe doit le publier. Retape 1 plus tard. |
| « un entraînement est déjà en cours » | Menu 3, puis 1 pour le voir. Attends sa fin ou arrête-le (4). |

**Quoi envoyer à l'équipe** : tape **5** (Préparer le message d'aide). Le fichier **message-pour-l-equipe.txt** est créé sur ton Bureau et copié dans le presse-papiers : colle-le (Ctrl+V) dans la conversation, avec une capture d'écran si possible. Il ne contient ni mot de passe ni clé privée.

Tes clés privées restent sur ton PC : ne les envoie jamais, l'équipe ne les demandera jamais. Le programme se met à jour tout seul (menu 8 pour forcer).
