#!/usr/bin/env bash
# build-melonds.sh: build the melonDS Qt 6 front end for WebAssembly (multi-threaded Qt kit).
# Inputs (read-only mounts): /src/melonds (vendor/melonds at its pinned gitlink) and
# /patches/melonds. Output: /out (melonDS.{html,js,wasm}, qtloader.js, build.json).
# melonDS needs threads: its emulation runs on a QThread and Qt's single-threaded kit cannot
# start one, so only the wasm_multithread kit is built (the page must be cross-origin isolated).
set -euo pipefail
src=/work/melonds build=/work/build-melonds
# /work is a named volume: the build tree is reused between runs (CLEAN=1 starts over).
rm -rf "$src" && mkdir -p "$src" /out
[ "${CLEAN:-0}" = 1 ] && rm -rf "$build"
tar -C /src/melonds --exclude=.git -cf - . | tar -C "$src" -xf -
for p in /patches/melonds/*.patch; do patch -d "$src" -p1 --forward < "$p"; done

export PKG_CONFIG_LIBDIR="$WASM_DEPS_MT/lib/pkgconfig" PKG_CONFIG_PATH=
# melonDS throws (toml11 config parsing): the Qt 6.12 kit has wasm-exceptions disabled, so C++
# exceptions use Emscripten's JS-based model (-fexceptions at compile and link).
opt="-O3 -flto -msimd128"
cxxopt="$opt -fexceptions"
link="-L$WASM_DEPS_MT/lib;-fexceptions;-sUSE_ZLIB=1;-O3;-flto;-msimd128;-sALLOW_MEMORY_GROWTH=1;-sUSE_SDL=2;-sPTHREAD_POOL_SIZE=6"
# Closure Compiler (ADVANCED) fails on the Emscripten 5.0.5 glue of this Qt kit
# ("JSC_UNDEFINED_VARIABLE setTempRet0" in the C++ exception helpers); MELONDS_CLOSURE=1 retries it.
if [ "${MELONDS_CLOSURE:-0}" = 1 ]; then link="$link;--closure=1"; fi
# Diagnostics: C++ exception messages and stacks, runtime assertions (MELONDS_DEBUG=1).
if [ "${MELONDS_DEBUG:-0}" = 1 ]; then link="$link;-sASSERTIONS=1;-sEXCEPTION_STACK_TRACES=1"; fi
"$QT_WASM_MT/bin/qt-cmake" -S "$src" -B "$build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DQT_HOST_PATH="$QT_HOST_PATH" \
  -DCMAKE_C_FLAGS="$opt" -DCMAKE_CXX_FLAGS="$cxxopt" \
  -DCMAKE_PREFIX_PATH="$WASM_DEPS_MT" -DPKG_CONFIG_EXECUTABLE=/usr/bin/pkg-config \
  -DBUILD_QT_SDL=ON -DUSE_QT6=ON -DENABLE_JIT=OFF -DENABLE_OGLRENDERER=ON \
  -DENABLE_GDBSTUB=OFF -DENABLE_WAYLAND=OFF -DENABLE_LTO_RELEASE=OFF \
  -DMELONDS_WASM_LINK_OPTIONS="$link"
cmake --build "$build" --target melonDS -- -k 0
out="$(dirname "$(find "$build" -name melonDS.wasm -not -path "*/CMakeFiles/*" | head -1)")"
cp "$out"/melonDS.{html,js,wasm} "$out"/qtloader.js /out/
[ -f "$out/melonDS.worker.js" ] && cp "$out/melonDS.worker.js" /out/ || true
cat > /out/build.json <<JSON
{
  "core": "melonds",
  "frontend": "qt6",
  "qt": "$(basename "$(dirname "$QT_WASM_MT")")",
  "qtKit": "wasm_multithread",
  "emscripten": "$(emcc --version | head -1 | sed 's/.*) //;s/ .*//')",
  "closure": ${MELONDS_CLOSURE:-0},
  "flags": "$opt",
  "link": "$link"
}
JSON
ls -la /out
