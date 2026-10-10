# Audit accès matériel Windows–WSL–WSLg

Audit en lecture seule du 2026-10-01. Le tunnel Aphrody transporte des commandes, résultats et événements ; il ne modifie ni l'architecture Hyper-V ni les privilèges du noyau Windows. Les observations ci-dessous distinguent le code consulté et l'état effectivement mesuré.

## Révisions consultées

- WSL : `c34e75aea8dcc50c0c2f9e76b2de9b26a58e8b67`, `.cache/upstream/WSL` (not in repo) (generated or machine-local artifact; presence depends on the build host).
- WSLg : `6942bb534b537302a7a22617261d9274db3cfa37`, `.cache/upstream/wslg` (not in repo) (generated or machine-local artifact; presence depends on the build host).
- Windows Terminal : `2b5336c1fca1e53ceeaac09710a13c478938cc8d`, `.cache/upstream/terminal` (not in repo) (generated or machine-local artifact; presence depends on the build host).
- WSL2-Linux-Kernel : `14794180686c2fb6307fbe359c359bec765249f3`, `.cache/upstream/WSL2-Linux-Kernel` (not in repo) (generated or machine-local artifact; presence depends on the build host). Checkout terminé et propre pendant cet audit.

Les chemins et numéros de ligne ci-dessous sont relatifs à ces clones, donc reproductibles aux révisions indiquées. Le HEAD du clone n'est pas une preuve que le binaire installé a été construit avec ce même HEAD.

## Conclusions vérifiées dans les sources

### Le service Windows et la session WSL ont des identités différentes

`WSL/src/windows/service/exe/LxssUserSessionFactory.cpp:195–200` obtient le jeton utilisateur et rejette explicitement un jeton LocalSystem avec `WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED`. Un service Windows SYSTEM peut administrer le matériel et héberger le côté hôte du tunnel ; lancer directement `wsl.exe` sous SYSTEM n'est pas une solution étayée pour démarrer la distribution de l'utilisateur.

`WSL/src/windows/common/GuestDeviceManager.cpp:89–100` impersonne le jeton utilisateur, lit `TokenSessionId` et construit `\\Sessions\\<session>\\BaseNamedObjects\\WSL\\<VM>`. La mémoire partagée WSLg appartient donc à un espace de noms de session utilisateur. Le contrôle du bureau visible doit rester dans un compagnon interactif de cette session, séparé du service SYSTEM. Ce code ne démontre pas à lui seul les permissions de chaque API de capture Windows.

### GPU : périphérique paravirtualisé, pas exclusivité physique

`WSL/src/windows/service/exe/WslCoreVm.cpp:391–406` active `VirtualMachine/ComputeTopology/Gpu`, `GpuAssignmentMode::Mirror` et les extensions fournisseur. Le code peut également désactiver GDI/presentation dans la configuration vGPU. Cela établit un GPU virtualisé via le pilote Windows ; cela ne constitue pas une assignation PCI exclusive du GPU complet.

La présence de `/dev/dxg` et de `libcuda.so`/`libd3d12.so` permet des API compatibles dans l'invité. L'administration Windows peut compléter avec DXGI/D3D12/NVML et les opérations de pilote prises en charge côté hôte. Un RPC générique ne transforme pas `/dev/dxg` en pilote Linux natif PCI ni ne garantit toutes les opérations CUDA/NVML, accès aux BAR, VRAM brute ou ressources réservées au pilote hôte.

### RAM : capacité mémoire de la VM, pas RAM physique hôte brute

`WSL/src/windows/common/WslCoreConfig.cpp:311–321` lit `GlobalMemoryStatusEx`, définit `MaximumMemorySizeBytes = ullTotalPhys`, prend la moitié par défaut et borne une valeur explicite entre 256 MiB et la mémoire physique totale. `WSL/src/windows/service/exe/WslCoreVm.cpp:1485` convertit cette capacité en `ComputeTopology.Memory.SizeInMB` pour HCS. Augmenter la limite configure la capacité de l'invité ; ce n'est pas un mappage de toutes les pages physiques Windows dans Linux.

Le `/dev/mem` de l'invité, s'il existe, concerne son espace d'adressage physique invité et reste soumis au code/configuration du noyau invité. LocalSystem est une identité de processus utilisateur Windows, et ne constitue pas un pilote noyau donnant accès arbitraire aux pages physiques hôte. Ce dernier point est une limite architecturale ; aucune fonctionnalité d'accès brut à la RAM hôte n'a été trouvée dans les propriétaires WSL consultés.

### Disques : fichiers partagés, VHD et passthrough sont trois contrats distincts

`WSL/src/windows/service/exe/WslCoreVm.cpp:1017–1078` implémente `DiskType::PassThrough` : autorisation au processus VM, ouverture du disque en lecture/écriture, passage hors ligne Windows s'il était en ligne, puis `hcs::AddPassThroughDisk`. Le bloc `1080–1115` traite séparément les VHD et la propriété utilisateur.

`WSL/src/windows/common/disk.cpp:25` ouvre le périphérique Windows et `:54` appelle `DeviceIoControl`. Le service SYSTEM peut offrir des opérations hôte explicites et bornées sur des disques/volumes accessibles. Exporter un fichier via DrvFS/virtiofs ne fournit pas un périphérique bloc physique. Le passthrough natif nécessite l'exclusivité appropriée ; il ne faut pas promettre que le disque Windows de démarrage, restant utilisé par Windows, sera simultanément attaché brut à WSL.

### Réseau et ports : deux piles réseau distinctes

`WSL/src/windows/common/WslCoreConfig.cpp:152–157` active toujours le pare-feu Hyper-V en mode mirrored ; `:394–395` indique que le paramètre local ne le désactive pas dans ce mode. `:481–484` borne `IgnoredPorts` et `EnableHostAddressLoopback` au mode mirrored. Les noms de paramètres sont définis dans `WslCoreConfig.h:246,293–294`.

Un helper Windows peut ouvrir les sockets Windows, administrer les interfaces/routes et utiliser les pilotes de capture installés. Root Linux administre les interfaces et ports invités. Une liaison vsock évite le transport IP pour les messages du bridge ; elle ne supprime pas les politiques appliquées aux connexions IP effectuées ensuite, ne copie pas automatiquement tous les sockets Windows dans Linux et ne remplace pas une interface réseau physique par un accès PCI direct.

### WSLg : interface graphique et audio déjà spécialisés

`wslg/WSLGd/main.cpp:319–329` monte la mémoire partagée `virtiofs` avec DAX. `:331–351` écoute AF_VSOCK dans la plage réservée. `:454–509` lance `mstsc`/`msrdc` via `/init` avec le VM ID, le service Hyper-V et le chemin de mémoire partagée. `wslg/README.md:146–163` décrit Weston/XWayland, RAIL/VAIL, la mémoire partagée, le presse-papiers et PulseAudio RDP.

Le bridge peut compléter les API de bureau Windows absentes de cette intégration, les inventaires, événements et commandes de pilote. Il ne faut pas prétendre que WSLg oublie tout l'audio, tout le presse-papiers ou toute accélération graphique : des canaux spécialisés existent déjà. Une transmission de buffers GPU/frames/flux audio faible latence demanderait un protocole et des propriétaires dédiés, avec mesure des copies, tailles, débit, synchronisation et backpressure ; du JSON RPC n'est pas cette preuve.

### Le choix Hyper-V socket correspond au transport natif WSL

`WSL/src/windows/common/hvsocket.cpp:22–28` remplit `AF_HYPERV`, le GUID de VM et `HV_GUID_VSOCK_TEMPLATE`, puis met le port dans `ServiceId.Data1`. `WSL/src/linux/init/util.cpp:612–616` connecte `AF_VSOCK` à `VMADDR_CID_HOST` et au port donné. Ceci appuie le bridge natif inter-VM utilisé par Aphrody. Les GUID et le ciblage de la VM sont réels ; ils ne prouvent aucune permission matérielle supplémentaire.

### Windows Terminal est un client terminal

`terminal/src/cascadia/TerminalConnection/ConptyConnection.cpp:166` lance le processus via `CreateProcessW` et `:412` crée la pseudoconsole avec `ConptyCreatePseudoConsole`. Il fournit une intégration de shell/session, pas un mécanisme d'élévation ni un tunnel générique de pilotes, GPU ou mémoire physique.

## État du poste mesuré en lecture seule

- Noyau invité actif : `6.18.33.2-microsoft-standard-WSL2`.
- `/dev/dxg` et `/dev/vsock` : périphériques caractères présents, mode `0666`.
- `/dev/mem` : présent, groupe `kmem`, mode `0640` ; `/dev/kvm` présent, groupe `kvm`, mode `0660`. Aucune lecture brute réalisée.
- `/proc/meminfo` : `MemTotal = 26670764 kB` (capacité invitée visible). Windows CIM : `TotalVisibleMemorySize = 33363336 KiB`. Les deux espaces ne se confondent pas.
- GPU Windows/WSL : NVIDIA GeForce RTX 4070. `nvidia-smi` WSL annonce `12282 MiB` et pilote `616.92`. La propriété CIM `Win32_VideoController.AdapterRAM` étant 32 bits, sa valeur n'est pas utilisée comme mesure de VRAM sur ce GPU.
- Disque Windows : un NVMe Micron d'environ 1,024 To, disque 0, `IsBoot = true`, `IsSystem = true`, en ligne. Aucun changement d'état réalisé.
- Linux voit `sda` 356,9 MiB, `sdb` 159,4 MiB, `sdc` 8 GiB swap, `sdd` 1 TiB root. Ces périphériques ne prouvent pas une exposition brute du NVMe physique.
- Linux : `lo` et `eth0` Hyper-V. Windows : Ethernet Intel I226-V, vEthernet WSL, Npcap Loopback et TAP-Windows présents. L'existence de Npcap ne prouve pas que toutes ses API ou interfaces sont exposées par Aphrody.

## Suite concrète proposée

1. Conserver trois autorités explicites : service Windows SYSTEM pour hôte/pilotes, helper Linux root pour invité, compagnon utilisateur pour desktop/WSLg. Exposer identité effective, session, capacités disponibles et erreurs réelles.
2. Ajouter inventaires typés puis opérations Windows nécessaires via propriétaires existants : SetupAPI/Configuration Manager pour périphériques/pilotes, DXGI/NVML pour GPU, volumes/IOCTL de disque en lecture seule d'abord, IP Helper/WFP/capture Npcap pour réseau selon le besoin réel. Chaque API demande son contrat et sa vérification, pas un simple booléen « accès complet ».
3. Exposer capacités GPU WSL réellement disponibles et mesures ; proposer l'exécution côté Windows lorsqu'une opération fournisseur n'est pas supportée par l'invité.
4. Traiter USB avec un mécanisme USB/IP réel côté Windows et un pilote invité disponible, identifier exactement les périphériques avant attachement. Ne pas extrapoler les capacités USB/IP à tout PCI.
5. Ne pas attacher le NVMe système utilisé par Windows au titre d'une promesse générale. Préparer des scénarios VHD/données dédiés ou opérations hôte bornées.
6. Pour le démarrage avant logon, vérifier la création de la session WSL sous le compte propriétaire et le résultat du task scheduler. L'interdiction explicite de LocalSystem dans les sources est un critère de test essentiel. La capture interactive reste liée au logon.
7. Mesurer séparément RTT messages, débit flux, temps d'API matériels et reprise après changement de VM ; tester refus d'authentification et limites de queues. Les chiffres de ping n'établissent pas un débit GPU/audio/disque.


## Revue du noyau cloné et comparaison au noyau actif

Le fichier `WSL2-Linux-Kernel/Microsoft/config-wsl` active :

- `CONFIG_HYPERV_VSOCKETS=y` à la ligne 1819 ; stockage et réseau Hyper-V à 2354 et 2867.
- `CONFIG_DEVMEM=y` à 3087, mais `CONFIG_STRICT_DEVMEM=y` et `CONFIG_IO_STRICT_DEVMEM=y` à 7352–7353.
- USB/IP core et VHCI en modules à 4935–4939, 8 ports VHCI et un contrôleur dans cette configuration.
- `CONFIG_DXGKRNL=y` à 5352.

La lecture de `/proc/config.gz` sur le poste confirme ces mêmes valeurs pour le noyau réellement actif. `lsmod` n'a pas montré de module USB/IP/VHCI chargé au moment de la mesure ; aucun périphérique USB n'était listé sous `/sys/bus/usb/devices`. La présence de l'option compilée n'est donc pas une preuve d'un périphérique déjà attaché.

### dxgkrnl expose un client de virtualisation graphique

`drivers/hv/dxgkrnl/dxgmodule.c:925–943` enregistre le miscdevice nommé `dxg`, mode `0666`, puis le pilote VMBus. `:838–852` définit les callbacks du pilote VMBus et du pilote PCI synthétique. `drivers/hv/dxgkrnl/dxgvmbus.c:414–472` envoie les commandes synchrones vers l'hôte par `vmbus_sendpacket`; le type de canal VM→host est explicitement défini à `:169` et `:284`. La présence d'un pilote PCI enregistré dans ce module ne signifie pas que le GPU physique a été assigné de façon exclusive : le chemin de commande observé demeure VMBus vers l'hôte.

### Même root ne dispose pas de toutes les pages via /dev/mem

`drivers/char/mem.c:59–63` délègue l'autorisation de page à `devmem_is_allowed` lorsque `CONFIG_STRICT_DEVMEM` est actif. `arch/x86/mm/init.c:868–894` refuse les régions `IORESOURCE_SYSTEM_RAM` (exception du premier MiB, retourné comme zéros pour les pages RAM interdites) puis les régions I/O exclusives. Changer uniquement le mode Unix du périphérique ou exécuter en root ne contourne pas ces vérifications de code. Elles portent en outre sur l'espace physique de l'invité ; aucune lecture de RAM brute n'a été réalisée dans cet audit.

### USB/IP nécessite une socket et un véritable backend USB

`drivers/usb/usbip/vhci_sysfs.c:309–337` parse un attachement VHCI; `:360–382` récupère la socket transmise avec `sockfd_lookup`, exige `SOCK_STREAM` et crée les workers de transport. `drivers/usb/usbip/vhci_hcd.c:20–21` identifie explicitement un contrôleur hôte USB virtuel. Ceci fournit une piste concrète USB/IP côté invité. Le matériel USB Windows exige encore un backend/exporteur compatible et un protocole USB/IP réel ; un outil RPC ordinaire n'est pas une URB USB.

Le contrôle `SOCK_STREAM` seul dans ce bloc n'établit pas l'ensemble des familles de socket effectivement compatibles avec le transport USB/IP et ses traitements d'erreur. Ne pas promettre un transport USB/IP directement AF_VSOCK sans audit et essai dédiés de tous les propriétaires concernés.

### Transport : hôte direct et reprise obligatoire après hibernation

`net/vmw_vsock/hyperv_transport.c:113–143` documente les contraintes CID Linux : connexion vers `VMADDR_CID_HOST`/ANY et écoute locale ANY, contre endpoint `<VmID,ServiceId>` côté Windows. Ce n'est pas un routeur IP ou un accès arbitraire à d'autres VM.

`net/vmw_vsock/hyperv_transport.c:925–929` indique explicitement que les connexions hv_sock ne survivent pas à l'hibernation et que leurs canaux sont révoqués avant celle-ci. Le bridge doit redécouvrir/réouvrir le canal et réenregistrer ses outils ; une commande mutatrice dont l'issue est inconnue ne doit pas être rejouée automatiquement.
