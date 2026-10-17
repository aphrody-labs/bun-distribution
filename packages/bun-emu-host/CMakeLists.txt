# Bun OS emulator host: one plugin library per C++ emulator core, all exporting
# the C ABI in include/bun_emu_host.h. Each core has its own build tree because
# the cores bundle incompatible copies of shared code (Dolphin's and Azahar's
# `Common` namespaces, fmt, ...).
#
# This top-level project builds cores that are plain libraries (melonDS). Cores
# whose CMake must stay top-level (Dolphin, Azahar, Kyty) are configured from
# their own source tree with cmake/inject.cmake; see scripts/build.ts.
cmake_minimum_required(VERSION 3.25)
project(bun_emu_host VERSION 0.1.0 LANGUAGES C CXX)

set(BUN_EMU_CORE "melonds" CACHE STRING "Core plugin built by this tree")
set_property(CACHE BUN_EMU_CORE PROPERTY STRINGS melonds)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()
# Rust and Bun both load the plugin next to the release CRT.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreadedDLL")
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/host.cmake")
bun_emu_add_plugin(${BUN_EMU_CORE})
include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/${BUN_EMU_CORE}.cmake")
