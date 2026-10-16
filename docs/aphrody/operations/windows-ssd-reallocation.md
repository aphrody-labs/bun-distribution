<!-- SPDX-License-Identifier: Apache-2.0 -->

# Réallocation du SSD Windows

Résultat du 14 octobre 2026, exécuté et vérifié par le propriétaire via WinClean
natif et `sudo` Windows avec un véritable token administrateur.

Trois anciens caches ignorés par Git ont été supprimés : **106 365 163 942 octets**.
Les fichiers utilisateur, `C:\bun` et les sorties runtime release/debug ont été
préservés. Le nettoyage initial avait laissé **106 518 007 808 octets** libres.

Sur le disque GPT 0 `NVMe Micron_2400_MTFDKBA1T0QFM`, les partitions Recovery 4,
RESTORE 5 et MYASUS Recovery 6 ont été supprimées après désactivation effective
de WinRE. L'EFI 1 et la MSR 2 conservent leurs GUID, types, offsets et tailles.
La partition système C 3 conserve son GUID, type et offset et a été étendue au
SizeMax interrogé. État final vérifié :

| Élément | Résultat |
| --- | --- |
| Partitions du disque 0 | 3 : EFI, MSR, C |
| Taille de la partition C | 1 023 919 070 720 octets |
| Espace libre C lors du contrôle propriétaire | 131 708 145 664 octets |
| LargestFreeExtent disque 0 | 0 |
| WinRE | Disabled |
| BitLocker avant mutation | FullyDecrypted / ProtectionOff / Unlocked / 0 % |
| B | Alias SUBST retiré dans la session utilisateur d'origine |
| C:\bun et runtime release | Préservés |

L'espace libre est une observation datée et peut changer. La première tentative
`reagentc /disable` avait échoué (retour 1, erreur 70) et WinRE était resté Enabled ;
aucune partition n'a été supprimée sur ce retour. La désactivation a ensuite passé
après récupération de capacité disque.

`tools/config/host/windows/ssd-reallocation-plan.ps1` reste en lecture seule :
il accepte le préflight exact des six partitions initiales ou les trois partitions
finales et B absent dans la session courante. L'état final délègue à
`ssd-reallocation.ps1 -Phase verify` lorsqu'il dispose du token administrateur ;
sans ce token, il indique explicitement que WinRE n'a pas été requalifié.
Cette phase verify ne désactive WinRE, ne supprime et ne redimensionne rien.
Les phases de mutation ne constituent pas une nouvelle opération à rejouer.
