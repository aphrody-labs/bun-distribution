# Bun / Android

Bun tourne sur le poste Windows pour construire le JavaScript consommé par un navigateur ou la WebView de l'application Compose native. La release officielle Aphrody actuellement publiée ne contient aucun binaire Android ARM64. Ce package n'installe donc pas un runtime Bun sur téléphone.

`@aphrody/tauri` provient du checkout canonique voisin `../../../bun/packages/bun-tauri`, version 1.4.4. Il n'est pas publié au registre npm. Le wrapper racine `scripts/bun.ps1` utilise le vrai build natif Bun 1.4.4 du checkout, sans remplacer Bun global. Configurations possibles : `APHRODY_BUN_CHECKOUT` ou `ANDROID_BUN_BIN`. Le binaire local rapporte `1.4.4-canary.1` dans les commandes d'exécution.

L'interopérabilité actuelle est Bun FFI ↔ DLL Rust sur Windows, et Java/Kotlin JNI ↔ Rust dans Android. L'application Android utilise Compose et une WebView standard; l'intégration Tauri Android n'est pas qualifiée. La dépendance du fork Tauri est conservée pour ses API disponibles; son pont JavaScript est uniquement testé avec un mock séparé.

- `bun install` installe la dépendance locale sans en recopier le source dans ce projet.
- `bun run build` construit `dist/` pour une WebView.
- `bun run dev` sert le bundle sur `127.0.0.1:1430`.
- `bun run android:doctor` vérifie le runtime hôte, adb, Java, Rust et cargo-ndk.
- `bun run android:devices`, `bun run android:install chemin.apk` et `bun run android:logcat` utilisent adb.
- `bun run android:sdk` utilise la nouvelle CLI `android sdk list`; les arguments supplémentaires deviennent `android sdk ...`.
- `bun run rust:ndk -- -t arm64-v8a build --release` utilise cargo-ndk dans un projet Rust.
- À la racine, `bun run ffi` charge le vrai DLL Rust `target/rust/debug/android_native.dll` et appelle `android_add(17, 25)`. `bun run test` vérifie aussi ce pont FFI, sans simulation. `ANDROID_NATIVE_LIB` peut sélectionner explicitement un artefact. `bun run java:ffi` vérifie JNI Java21 et Foreign Function & Memory Java27 avec le même DLL.

Le SDK est résolu par ANDROID_HOME, ANDROID_SDK_ROOT, puis le dossier racine `../../sdk`. Java est résolu par JAVA_HOME, puis `../../tools/jdk`, puis le PATH. Rust utilise le PATH du poste et la nightly déclarée à la racine. Le frontend seul ne produit pas d'APK; il doit être intégré à une application Android/Tauri native.
