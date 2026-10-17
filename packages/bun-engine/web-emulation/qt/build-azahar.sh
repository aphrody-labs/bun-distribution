#!/usr/bin/env bash
# build-azahar.sh: attempt the Azahar (3DS) Qt 6 front end for WebAssembly with the
# multi-threaded Qt kit. Inputs (read-only mounts): /src/azahar (vendor/azahar with its
# externals) and /patches/azahar. Output: /out (azahar.{html,js,wasm}, qtloader.js, build.json,
# or build.log with the first blocking error).
#
# Configuration: interpreter CPU (dynarmic is only built for x86_64/arm64 hosts), software
# renderer (the OpenGL renderer needs GL 4.3/GLES 3.2, WebGL2 is GLES 3.0; no Vulkan in
# browsers), no web services, scripting RPC, GDB stub, libusb, FFmpeg, cubeb or Discord, and
# no built-in key blob: console keys are never shipped.
set -uo pipefail
src=/work/azahar build=/work/build-azahar
rm -rf "$src" "$build" && mkdir -p "$src" /out
tar -C /src/azahar --exclude=.git -cf - . | tar -C "$src" -xf -
for p in /patches/azahar/*.patch; do [ -f "$p" ] && patch -d "$src" -p1 --forward < "$p"; done

export PKG_CONFIG_LIBDIR="$WASM_DEPS_MT/lib/pkgconfig" PKG_CONFIG_PATH=
opt="-O3 -flto -msimd128 -pthread -fexceptions"
link="-fexceptions;-O3;-flto;-msimd128;-pthread;-sALLOW_MEMORY_GROWTH=1;-sINITIAL_MEMORY=536870912;-sMAXIMUM_MEMORY=4294967296;-sPTHREAD_POOL_SIZE=12;-lopenal"
{
  "$QT_WASM_MT/bin/qt-cmake" -S "$src" -B "$build" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release -DQT_HOST_PATH="$QT_HOST_PATH" \
    -DCMAKE_C_FLAGS="$opt" -DCMAKE_CXX_FLAGS="$opt" -DCMAKE_EXE_LINKER_FLAGS="${link//;/ }" \
    -DCMAKE_PREFIX_PATH="$WASM_DEPS_MT" -DPKG_CONFIG_EXECUTABLE=/usr/bin/pkg-config \
    -DENABLE_QT=ON -DENABLE_QT_TRANSLATION=OFF -DENABLE_QT_UPDATE_CHECKER=OFF \
    -DENABLE_SDL2=ON -DUSE_SYSTEM_SDL2=OFF -DENABLE_TESTS=OFF -DENABLE_ROOM=OFF \
    -DENABLE_WEB_SERVICE=OFF -DENABLE_SCRIPTING=OFF -DENABLE_GDBSTUB=OFF \
    -DENABLE_CUBEB=OFF -DENABLE_OPENAL=ON -DENABLE_LIBUSB=OFF -DENABLE_FFMPEG=OFF \
    -DENABLE_SOFTWARE_RENDERER=ON -DENABLE_OPENGL=OFF -DENABLE_VULKAN=OFF \
    -DENABLE_DISCORD_RPC=OFF -DENABLE_MICROPROFILE=OFF -DENABLE_SSE42=OFF \
    -DENABLE_BUILTIN_KEYBLOB=OFF -DENABLE_LTO=OFF -DCITRA_USE_PRECOMPILED_HEADERS=OFF \
    -DCITRA_WARNINGS_AS_ERRORS=OFF -DENABLE_LIBRETRO=OFF \
  && cmake --build "$build" --target citra_meta -- -k 0
} 2>&1 | tee /out/build.log
status=${PIPESTATUS[0]}
out="$build/bin/Release"
[ -d "$out" ] || out="$build/bin"
if [ "$status" = 0 ] && ls "$out"/*.wasm >/dev/null 2>&1; then
  cp "$out"/*.{html,js,wasm} /out/ 2>/dev/null
  cat > /out/build.json <<JSON
{ "core": "azahar", "frontend": "qt6", "qtKit": "wasm_multithread", "flags": "$opt", "link": "$link" }
JSON
fi
exit "$status"
