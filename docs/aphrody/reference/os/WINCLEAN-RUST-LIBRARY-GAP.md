# WinClean — écart de bibliothèques Rust Windows

Cette note fige la recherche Context7/Microsoft Learn du 22 septembre 2026. Elle sert de
porte de décision avant d'ajouter une dépendance : aucune entrée du ledger ne doit passer à
   `rust` tant que le contrat historique n'est pas reproduit et testé sur Windows 11.

Les sondes crates.io du même jour confirment que `uiautomation` 0.25.1 et `windows-capture`
2.0.1 dépendent de `windows` 0.62.2, compatible avec la version `0.62` déjà déclarée au niveau
du workspace. Cela autorise une tranche d'intégration isolée ; cela ne constitue pas encore une
preuve de parité fonctionnelle.

## Bibliothèques retenues

| Surface historique | Bibliothèque Rust | Verdict |
| --- | --- | --- |
| Capture écran, `computer_record_clip` | `windows-capture` 2.0.1 (`GraphicsCaptureApiHandler`, encodeur MP4, PNG) | Candidate directe ; `computer_record_clip` reste en oracle jusqu'à preuve AVI/BI_RGB. |
| `snapshot` | `uiautomation` 0.25.1 (COM UIA, arbre control-view, propriétés et rectangle) | Intégré Rust ; cross-check Windows MSVC réussi, ledger `rust`. |
| UI Automation, `computer_click_element`, `multi_edit`, `multi_select` | `uiautomation` 0.25.1 (COM UIA, recherche d'éléments, patterns, capture de rectangle) | Candidate directe ; vérifier STA/MTA, droits élevés, contrôle absent et parité des erreurs. |
| API Win32/WinRT de base, OCR Windows, Speech, Windows Search | `windows` 0.62 déjà présent | Binding officiel ; les namespaces/fonctions doivent être ajoutés avec des features ciblées, sans wrapper générique. |
| ONNX/WinML, `winml_*` | `ort` 2.0.0-rc.12 (`load-dynamic`, `directml`, `cuda`) | Les quatre outils sont implémentés dans `aphrody-winclean::winml` avec chargement dynamique, inspection ONNX, providers CPU/DirectML/CUDA et exécution float32 bornée. La preuve runtime Windows reste dépendante de la présence d'`onnxruntime.dll` et des providers installés. |
| Gamepad ViGEm | `vigem-rust` 0.2.0, feature `x360`, backend `ViGEmClient.dll` | Intégré Rust ; service ViGEmBus actif et probe réel création/update/neutre/destruction validé. |
| `search_windows` | `windows` + COM/OLE DB `Search.CollatorDSO` | Implémenté dans `aphrody-winclean::windows_search`; validation runtime Windows Search encore requise. |

## Conclusions opérationnelles

1. `windows-capture` et `uiautomation` sont les deux ajouts réalistes pour réduire l'écart sans
   réécrire les contrats. Ils doivent être ajoutés dans `aphrody-winclean`, avec fonctionnalités
   Windows conditionnelles et tests d'intégration réels.
2. `windows` reste la dépendance système canonique. Les résultats Context7 indiquent que ses
   namespaces COM/WinRT sont générés depuis les métadonnées Windows ; une crate tierce ne doit
   pas le remplacer.
3. ONNX Runtime expose officiellement une voie Rust via la C API et le chargement d'une DLL
   (`RUST_ONNXRUNTIME_LIBRARY_PATH`). Context7 confirme que `ort` sait initialiser une DLL,
   retourner la version, charger les métadonnées de session, exécuter des tenseurs `f32` et
   enregistrer des EP compilés (`directml`/`cuda`). Cela ne prouve pas la parité WinML : le
   catalogue `ExecutionProviderCatalog` et ses opérations `EnsureAndRegisterCertifiedAsync`
   / `FindAllProviders` appartiennent au package Windows App SDK ML et n'ont pas de projection
   Rust disponible dans la dépendance `windows` 0.62 actuelle (qui expose seulement l'ancienne
   API `Windows.AI.MachineLearning`). Les quatre outils restent donc
   dans l'oracle jusqu'à validation d'un runtime et de DLL réels.
4. Aucun stub, scan approximatif ou fallback silencieux n'est acceptable. Les 166 outils du
   ledger sont maintenant **166/166 Rust**, avec compilation Linux/MSVC et test runtime WinML
   sur le DLL ONNX local. Windows Search est implémenté ; sa preuve positive dépend du fournisseur
   `Search.CollatorDSO`/service `WSearch` présent sur la machine cible.

## Sources vérifiées

- Context7 `/microsoft/windows-rs` : API Win32/WinRT et résolution des features.
- Context7 `/websites/rs_uiautomation_uiautomation` : COM UIA, éléments, patterns et capture.
- Context7 `/niiightmarexd/windows-capture` : Graphics Capture, PNG et MP4.
- Context7 `/microsoft/onnxruntime` : C API Rust, chargement de la DLL et providers.
- Context7 `/pykeio/ort` : `ort` 2.0.0-rc.12, `init_from`, `GetVersionString`, sessions,
  métadonnées et features `directml`/`cuda`.
- Microsoft Learn `windows/ai/new-windows-ml/api-reference` : WinML moderne dans le namespace
  `Microsoft.Windows.AI.MachineLearning`, fourni par `Microsoft.WindowsAppSDK.ML`.
- Microsoft Learn : Windows.Graphics.Capture, UI Automation et Rust for Windows.
