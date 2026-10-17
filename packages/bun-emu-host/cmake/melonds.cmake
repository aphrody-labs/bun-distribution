# melonDS core library (vendor/melonds, GPL-3.0): no Qt/SDL frontend, no OpenGL,
# no GDB stub, interpreter only. Build with clang-cl on Windows: the core uses
# GCC builtins and __int128 that MSVC does not provide.
set(MELONDS_DIR "${BUN_OS_ROOT}/vendor/melonds")
if(NOT EXISTS "${MELONDS_DIR}/src/NDS.cpp")
  message(FATAL_ERROR "vendor/melonds is missing: git submodule update --init --depth 1 vendor/melonds")
endif()

set(BUILD_QT_SDL OFF CACHE BOOL "" FORCE)
set(ENABLE_OGLRENDERER OFF CACHE BOOL "" FORCE)
set(ENABLE_GDBSTUB OFF CACHE BOOL "" FORCE)
set(ENABLE_JIT OFF CACHE BOOL "" FORCE)
set(ENABLE_LTO_RELEASE OFF CACHE BOOL "" FORCE)
set(USE_VCPKG OFF CACHE BOOL "" FORCE)
add_subdirectory("${MELONDS_DIR}" melonds EXCLUDE_FROM_ALL)

target_sources(${BUN_EMU_PLUGIN} PRIVATE
  "${BUN_EMU_HOST_DIR}/src/melonds/melonds_core.cpp"
  "${BUN_EMU_HOST_DIR}/src/melonds/melonds_platform.cpp")
target_link_libraries(${BUN_EMU_PLUGIN} PRIVATE core Qt6::Core)
if(MSVC AND CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
  # melonDS applies -fwrapv for GCC/Clang; clang-cl needs it spelled through /clang:.
  target_compile_options(core PRIVATE /clang:-fwrapv -Wno-invalid-offsetof -Wno-unused-parameter)
endif()
