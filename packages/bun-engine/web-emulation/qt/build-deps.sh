#!/usr/bin/env bash
# build-deps.sh <mt|st> <prefix>: build zstd, libarchive, faad2 and ENet for WebAssembly into
# <prefix> with pkg-config files, for the multi-threaded (pthreads) or single-threaded Qt kit.
set -euo pipefail
model="$1" prefix="$2"
flags="-O3 -flto -msimd128"
if [ "$model" = mt ]; then flags="$flags -pthread"; fi
export CFLAGS="$flags" CXXFLAGS="$flags" LDFLAGS="$flags"
common=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix"
  -DCMAKE_FIND_ROOT_PATH="$prefix" -DBUILD_SHARED_LIBS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5)
build() {
  local name="$1" src="$2"; shift 2
  local out="/tmp/build-$name-$model"
  emcmake cmake -S "$src" -B "$out" "${common[@]}" "$@"
  cmake --build "$out"
  cmake --install "$out"
  rm -rf "$out"
}
build zstd /src/zstd/build/cmake -DZSTD_BUILD_PROGRAMS=OFF -DZSTD_BUILD_TESTS=OFF \
  -DZSTD_BUILD_SHARED=OFF -DZSTD_BUILD_STATIC=ON -DZSTD_MULTITHREAD_SUPPORT=OFF
build libarchive /src/libarchive -DENABLE_TEST=OFF -DENABLE_TAR=OFF -DENABLE_CPIO=OFF \
  -DENABLE_CAT=OFF -DENABLE_UNZIP=OFF -DENABLE_ACL=OFF -DENABLE_XATTR=OFF -DENABLE_ICONV=OFF \
  -DENABLE_OPENSSL=OFF -DENABLE_MBEDTLS=OFF -DENABLE_NETTLE=OFF -DENABLE_LIBB2=OFF \
  -DENABLE_LZ4=OFF -DENABLE_LZMA=OFF -DENABLE_BZip2=OFF -DENABLE_LIBXML2=OFF -DENABLE_EXPAT=OFF \
  -DENABLE_PCREPOSIX=OFF -DENABLE_PCRE2POSIX=OFF -DENABLE_CNG=OFF -DENABLE_ZLIB=ON -DENABLE_ZSTD=ON \
  -DZSTD_INCLUDE_DIR="$prefix/include" -DZSTD_LIBRARY="$prefix/lib/libzstd.a" \
  -DCMAKE_C_FLAGS="$flags -sUSE_ZLIB=1"
build faad2 /src/faad2 -DFAAD_BUILD_CLI=OFF
# ENet has no install rules and no pkg-config file; install it the way melonDS looks it up.
emcmake cmake -S /src/enet -B /tmp/enet-$model -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/enet-$model
install -D /tmp/enet-$model/libenet.a "$prefix/lib/libenet.a"
cp -r /src/enet/include/enet "$prefix/include/"
rm -rf /tmp/enet-$model
mkdir -p "$prefix/lib/pkgconfig"
cat > "$prefix/lib/pkgconfig/libenet.pc" <<PC
prefix=$prefix
Name: libenet
Description: ENet reliable UDP (WebAssembly build)
Version: 1.3.18
Libs: -L\${prefix}/lib -lenet
Cflags: -I\${prefix}/include
PC
if [ ! -f "$prefix/lib/pkgconfig/faad2.pc" ]; then
  cat > "$prefix/lib/pkgconfig/faad2.pc" <<PC
prefix=$prefix
Name: faad2
Description: FAAD2 AAC decoder (WebAssembly build)
Version: 2.11.4
Libs: -L\${prefix}/lib -lfaad
Cflags: -I\${prefix}/include
PC
fi
# SDL2 is the Emscripten port; expose it through pkg-config like a system SDL2.
cat > "$prefix/lib/pkgconfig/sdl2.pc" <<PC
Name: sdl2
Description: SDL2 (Emscripten port)
Version: 2.32.0
Libs: -sUSE_SDL=2
Cflags: -sUSE_SDL=2
PC
