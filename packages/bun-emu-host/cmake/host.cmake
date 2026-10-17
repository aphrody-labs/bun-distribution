# Shared plugin definition: the host runtime (C ABI, instance services, Qt
# adapter) plus one core, linked into bun_emu_<core> as a shared library.
# Included from packages/bun-emu-host/CMakeLists.txt (melonDS) or injected at
# the end of an emulator's own top-level directory (Dolphin, Azahar, Kyty) by
# cmake/inject.cmake, so the core's directory-wide definitions apply.
include_guard(GLOBAL)

set(BUN_EMU_HOST_DIR "${CMAKE_CURRENT_LIST_DIR}/..")
get_filename_component(BUN_EMU_HOST_DIR "${BUN_EMU_HOST_DIR}" ABSOLUTE)
get_filename_component(BUN_OS_ROOT "${BUN_EMU_HOST_DIR}/../.." ABSOLUTE)
set(BUN_EMU_HOST_OUTPUT_DIR "${BUN_OS_ROOT}/build/emu-host/bin" CACHE PATH "Where plugins and their runtime DLLs land")
option(BUN_EMU_HOST_QT_GUI "Link Qt Gui and run cores on the offscreen platform" OFF)

function(bun_emu_add_plugin core)
  if(BUN_EMU_HOST_QT_GUI)
    find_package(Qt6 REQUIRED COMPONENTS Core Gui)
  else()
    find_package(Qt6 REQUIRED COMPONENTS Core)
  endif()

  set(plugin "bun_emu_${core}")
  add_library(${plugin} SHARED
    "${BUN_EMU_HOST_DIR}/src/host/abi.cpp"
    "${BUN_EMU_HOST_DIR}/src/host/qt_runtime.cpp")
  target_include_directories(${plugin} PRIVATE "${BUN_EMU_HOST_DIR}/include" "${BUN_EMU_HOST_DIR}/src")
  target_compile_definitions(${plugin} PRIVATE BUN_EMU_HOST_BUILD QT_NO_KEYWORDS)
  if(WIN32)
    target_compile_definitions(${plugin} PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
  endif()
  target_compile_features(${plugin} PRIVATE cxx_std_20)
  target_link_libraries(${plugin} PRIVATE Qt6::Core)
  if(BUN_EMU_HOST_QT_GUI)
    target_compile_definitions(${plugin} PRIVATE BUN_EMU_HOST_QT_GUI)
    target_link_libraries(${plugin} PRIVATE Qt6::Gui)
  endif()
  set_target_properties(${plugin} PROPERTIES
    PREFIX ""
    MSVC_RUNTIME_LIBRARY "MultiThreadedDLL"
    RUNTIME_OUTPUT_DIRECTORY "${BUN_EMU_HOST_OUTPUT_DIR}"
    LIBRARY_OUTPUT_DIRECTORY "${BUN_EMU_HOST_OUTPUT_DIR}")

  # Ship the Qt runtime with its own dependencies (pcre2, double-conversion,
  # zlib, ...); hosts add the plugin directory to the DLL search path.
  get_filename_component(vcpkg_bin "${Qt6_DIR}/../../bin" ABSOLUTE)
  file(GLOB runtime_dlls "${vcpkg_bin}/*.dll")
  add_custom_command(TARGET ${plugin} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different ${runtime_dlls} "${BUN_EMU_HOST_OUTPUT_DIR}")
  if(BUN_EMU_HOST_QT_GUI)
    get_filename_component(qt_plugins "${Qt6_DIR}/../../Qt6/plugins" ABSOLUTE)
    file(GLOB offscreen "${qt_plugins}/platforms/qoffscreen*.dll" "${qt_plugins}/platforms/libqoffscreen*")
    if(NOT offscreen)
      message(FATAL_ERROR "Qt offscreen platform plugin not found under ${qt_plugins} (qtbase needs the freetype feature)")
    endif()
    add_custom_command(TARGET ${plugin} POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E make_directory "${BUN_EMU_HOST_OUTPUT_DIR}/platforms"
      COMMAND ${CMAKE_COMMAND} -E copy_if_different ${offscreen} "${BUN_EMU_HOST_OUTPUT_DIR}/platforms")
  endif()
  set(BUN_EMU_PLUGIN ${plugin} PARENT_SCOPE)
endfunction()

# Give a plugin defined at the end of an emulator's top-level directory the
# directory-scoped definitions, options and include paths of one of the
# emulator's source directories (its targets get them from add_definitions(),
# add_compile_options() and include_directories() there).
function(bun_emu_inherit_directory target dir)
  get_directory_property(defs DIRECTORY "${dir}" COMPILE_DEFINITIONS)
  get_directory_property(opts DIRECTORY "${dir}" COMPILE_OPTIONS)
  get_directory_property(incs DIRECTORY "${dir}" INCLUDE_DIRECTORIES)
  target_compile_definitions(${target} PRIVATE ${defs})
  target_compile_options(${target} PRIVATE ${opts})
  target_include_directories(${target} PRIVATE ${incs})
endfunction()
