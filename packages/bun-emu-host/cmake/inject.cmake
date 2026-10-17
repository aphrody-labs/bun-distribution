# Passed as CMAKE_PROJECT_<emulator-project>_INCLUDE when an emulator's own
# CMakeLists.txt is the top-level project: runs right after its project() call
# and defers the plugin definition to the end of that top-level directory, so
# the plugin compiles with the emulator's directory-wide definitions, include
# paths and targets.
if(NOT BUN_EMU_CORE)
  message(FATAL_ERROR "inject.cmake needs -DBUN_EMU_CORE=<core>")
endif()
include("${CMAKE_CURRENT_LIST_DIR}/host.cmake")
include("${CMAKE_CURRENT_LIST_DIR}/${BUN_EMU_CORE}.options.cmake" OPTIONAL)
# Deferred arguments are expanded when the call runs: embed the path literally.
set(_bun_emu_core_cmake "${CMAKE_CURRENT_LIST_DIR}/${BUN_EMU_CORE}.cmake")
cmake_language(EVAL CODE "cmake_language(DEFER CALL include [[${_bun_emu_core_cmake}]])")
