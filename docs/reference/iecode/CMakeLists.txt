cmake_minimum_required(VERSION 3.25)
project(iecode LANGUAGES C CXX)

include(ExternalProject)

set(IECODE_CPP_SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}/src/iecode-cpp" CACHE PATH "iecode-cpp checkout")
set(IECODE_CSHARP_SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}" CACHE PATH "unified iecode workspace")
set(MELONDS_SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}/src/iecode-cpp/emulation/melonds" CACHE PATH "IECODE C++ melonDS subsystem")
set(IECODE_VCPKG_ROOT "$ENV{VCPKG_ROOT}" CACHE PATH "vcpkg repository used by the native subprojects")
set(IECODE_VCPKG_MANIFEST_DIR "${CMAKE_CURRENT_LIST_DIR}" CACHE PATH "central vcpkg manifest directory")
set(IECODE_VCPKG_TOOLCHAIN_FILE
    "${IECODE_VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"
    CACHE FILEPATH "vcpkg CMake toolchain passed to the native subprojects")
set(IECODE_VCPKG_TARGET_TRIPLET "" CACHE STRING "Optional vcpkg target triplet for both native subprojects")
option(BUILD_IECODE_CPP "Configure the preserved IECODE C/C++ toolkit" OFF)
option(TEST_IECODE_CSHARP "Run the .NET 10 IECODE reference tests" OFF)
option(BUILD_MELONDS "Configure the melonDS upstream checkout" OFF)
option(BUILD_MELONDS_QT6 "Build the optional Qt6/SDL frontend for melonDS" OFF)
option(BUILD_UNIFIED "Build and test the Rust/.NET IECODE integration" OFF)

if(BUILD_UNIFIED)
  set(BUILD_IECODE_CPP ON CACHE BOOL "" FORCE)
  set(TEST_IECODE_CSHARP ON CACHE BOOL "" FORCE)
  set(BUILD_MELONDS ON CACHE BOOL "" FORCE)
endif()

function(iecode_vcpkg_cmake_args out_var)
  if(NOT IECODE_VCPKG_ROOT)
    message(FATAL_ERROR
      "vcpkg is required for the native subprojects: set VCPKG_ROOT or IECODE_VCPKG_ROOT")
  endif()
  if(NOT EXISTS "${IECODE_VCPKG_TOOLCHAIN_FILE}")
    message(FATAL_ERROR
      "vcpkg toolchain is missing: ${IECODE_VCPKG_TOOLCHAIN_FILE}"
      " (set IECODE_VCPKG_ROOT to an existing vcpkg checkout)")
  endif()
  if(NOT EXISTS "${IECODE_VCPKG_MANIFEST_DIR}/vcpkg.json")
    message(FATAL_ERROR
      "Central vcpkg manifest is missing: ${IECODE_VCPKG_MANIFEST_DIR}/vcpkg.json")
  endif()

  set(_args
    "-DCMAKE_TOOLCHAIN_FILE=${IECODE_VCPKG_TOOLCHAIN_FILE}"
    "-DVCPKG_ROOT=${IECODE_VCPKG_ROOT}"
    "-DVCPKG_MANIFEST_DIR=${IECODE_VCPKG_MANIFEST_DIR}"
    "-DVCPKG_MANIFEST_MODE=ON"
  )
  if(IECODE_VCPKG_TARGET_TRIPLET)
    list(APPEND _args "-DVCPKG_TARGET_TRIPLET=${IECODE_VCPKG_TARGET_TRIPLET}")
  endif()
  set(${out_var} "${_args}" PARENT_SCOPE)
endfunction()

if(BUILD_IECODE_CPP)
  if(NOT EXISTS "${IECODE_CPP_SOURCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "IECODE_CPP_SOURCE_DIR does not contain CMakeLists.txt")
  endif()
  iecode_vcpkg_cmake_args(IECODE_CPP_VCPKG_ARGS)
  ExternalProject_Add(iecode_cpp
    SOURCE_DIR "${IECODE_CPP_SOURCE_DIR}"
    BINARY_DIR "${CMAKE_BINARY_DIR}/iecode-cpp"
    CMAKE_ARGS
      ${IECODE_CPP_VCPKG_ARGS}
      -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
      -DIECODE_BUILD_ENGINE=OFF
      -DIECODE_BUILD_GAME=OFF
      -DIECODE_UNITY_BUILD=OFF
      -DIECODE_LTO=OFF
    INSTALL_COMMAND ""
    BUILD_BYPRODUCTS "${CMAKE_BINARY_DIR}/iecode-cpp/src/iecode_cli"
    EXCLUDE_FROM_ALL
  )
endif()

if(TEST_IECODE_CSHARP)
  if(NOT EXISTS "${IECODE_CSHARP_SOURCE_DIR}/IECODE.sln")
    message(FATAL_ERROR "IECODE_CSHARP_SOURCE_DIR does not contain IECODE.sln")
  endif()
  ExternalProject_Add(iecode_csharp_test
    SOURCE_DIR "${IECODE_CSHARP_SOURCE_DIR}"
    CONFIGURE_COMMAND ""
    BUILD_COMMAND dotnet test src/IECODE/Core.Tests/IECODE.Core.Tests.csproj --configuration Release
    BUILD_IN_SOURCE ON
    INSTALL_COMMAND ""
    TEST_COMMAND ""
    EXCLUDE_FROM_ALL
  )
endif()

if(BUILD_MELONDS)
  if(NOT EXISTS "${MELONDS_SOURCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "MELONDS_SOURCE_DIR does not contain CMakeLists.txt")
  endif()
  iecode_vcpkg_cmake_args(MELONDS_VCPKG_ARGS)
  set(MELONDS_MANIFEST_FEATURES "")
  if(BUILD_MELONDS_QT6)
    set(MELONDS_MANIFEST_FEATURES "qt6")
  endif()
  ExternalProject_Add(melonds
    SOURCE_DIR "${MELONDS_SOURCE_DIR}"
    BINARY_DIR "${CMAKE_BINARY_DIR}/melonDS"
    CMAKE_ARGS
      ${MELONDS_VCPKG_ARGS}
      -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
      -DUSE_VCPKG=ON
      -DVCPKG_MANIFEST_FEATURES=${MELONDS_MANIFEST_FEATURES}
      -DBUILD_QT_SDL=${BUILD_MELONDS_QT6}
      -DENABLE_OGLRENDERER=${BUILD_MELONDS_QT6}
      -DENABLE_GDBSTUB=OFF
      -DENABLE_LTO=OFF
    INSTALL_COMMAND ""
    EXCLUDE_FROM_ALL
  )
endif()

if(BUILD_UNIFIED)
  find_program(CARGO_EXECUTABLE cargo REQUIRED)
  find_program(DOTNET_EXECUTABLE dotnet REQUIRED)
  if(NOT EXISTS "${CMAKE_CURRENT_LIST_DIR}/Cargo.toml")
    message(FATAL_ERROR "IECODE Rust workspace does not contain Cargo.toml")
  endif()

  add_custom_target(iecode_rust_ffi
    COMMAND "${CARGO_EXECUTABLE}" build --manifest-path "${CMAKE_CURRENT_LIST_DIR}/Cargo.toml" -p iecode-ffi --locked
    WORKING_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}"
    COMMENT "Build the unified iecode Rust FFI"
    VERBATIM
  )
  add_custom_target(iecode_rust_cli
    COMMAND "${CARGO_EXECUTABLE}" check --manifest-path "${CMAKE_CURRENT_LIST_DIR}/Cargo.toml" -p iecode-cli --locked
    WORKING_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}"
    COMMENT "Check the common Rust CLI surface"
    VERBATIM
  )
  add_custom_target(iecode_shared_rust
    COMMAND "${CARGO_EXECUTABLE}" test --manifest-path "${CMAKE_CURRENT_LIST_DIR}/Cargo.toml" --workspace --locked
    WORKING_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}"
    COMMENT "Test the Rust libraries absorbed into IECODE"
    VERBATIM
  )
  add_custom_target(iecode_dotnet
    COMMAND "${DOTNET_EXECUTABLE}" test IECODE.sln --configuration Release --no-restore
    WORKING_DIRECTORY "${IECODE_CSHARP_SOURCE_DIR}"
    COMMENT "Test the unified .NET IECODE surface"
    VERBATIM
  )
  # Keep the managed restore/test process after native compilation on constrained
  # hosts; concurrent CLR + rustc startup can abort the CLR before any test runs.
  add_dependencies(iecode_dotnet iecode_rust_ffi iecode_rust_cli iecode_shared_rust)
  add_custom_target(iecode_native DEPENDS iecode_cpp melonds)
  add_custom_target(iecode ALL DEPENDS iecode_native iecode_rust_ffi iecode_rust_cli iecode_shared_rust iecode_dotnet)
  if(TARGET iecode_csharp_test)
    add_dependencies(iecode iecode_csharp_test)
  endif()
endif()

if(NOT BUILD_IECODE_CPP AND NOT TEST_IECODE_CSHARP AND NOT BUILD_MELONDS AND NOT BUILD_UNIFIED)
  message(STATUS "Source workspaces discovered; no external build requested")
endif()
