# Rust Android JNI

Bibliothèque JNI et C FFI Rust nightly pour Windows et Android (`arm64-v8a`, `armeabi-v7a`, `x86` et `x86_64`, API minimale 23). La toolchain est définie au niveau du workspace sans changer la toolchain Rust par défaut du poste.

Depuis la racine du workspace :

```powershell
pwsh -NoProfile -File scripts/build-rust.ps1
```

La compilation utilise cargo-ndk et le NDK installé dans `sdk/ndk/30.0.16248370`. Les `.so` sont placés dans `target/android/jniLibs/<ABI>/`. Copier ces quatre dossiers dans `app/src/main/jniLibs` et la classe Java `apps/java-ffi/src/com/aphrody/android/NativeBridge.java` dans les sources Java de l'application Android. `NativeBridge.add(20, 22)` renvoie `42` et écrit dans Logcat sous le tag `AphrodyRust` sur Android.

Pour Windows, `pwsh -NoProfile -File scripts/build-rust.ps1 -HostOnly` produit `target/rust/debug/android_native.dll`. L'export `android_add(int32_t, int32_t)` permet également d'appeler cette bibliothèque depuis Bun FFI. Les deux exports saturent les additions qui dépassent l'intervalle `int32_t`.

Smoke JNI Java Windows depuis la racine :

```powershell
tools/jdk/bin/javac.exe -d target/java-ffi apps/java-ffi/src/com/aphrody/android/NativeBridge.java apps/java-ffi/src/com/aphrody/android/FfiSmoke.java
tools/jdk/bin/java.exe -Djava.library.path=target/rust/debug -cp target/java-ffi com.aphrody.android.FfiSmoke
```

Le test FFM JDK 27 appelle directement l'export C de la même DLL, avec l'API standard `java.lang.foreign` :

```powershell
tools/jdk-latest/jdk-27+35/bin/javac.exe -d target/java-ffi27 apps/java-ffi/src/com/aphrody/android/ForeignSmoke.java
tools/jdk-latest/jdk-27+35/bin/java.exe --enable-native-access=ALL-UNNAMED -cp target/java-ffi27 com.aphrody.android.ForeignSmoke
```

Les crates `jni`, `ndk` et `android_logger` sont utilisées par le pont. `android-activity` n'est pas nécessaire pour une bibliothèque chargée par une activité Java existante.

Versions vérifiées dans le registre crates.io le 12 octobre 2026 : [ndk 0.9.0](https://crates.io/crates/ndk), [jni 0.22.4](https://crates.io/crates/jni), [android_logger 0.15.1](https://crates.io/crates/android_logger) et [log 0.4.34](https://crates.io/crates/log). `Cargo.lock` fixe leurs dépendances transitives.

Le script vérifie les architectures ELF et l'export JNI après édition de liens. L'exécution sur appareil nécessite un appareil ou émulateur Android disponible.
