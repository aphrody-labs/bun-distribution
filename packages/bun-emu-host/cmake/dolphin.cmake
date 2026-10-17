# Dolphin (vendor/dolphin, GPL-2.0-or-later): evaluated at the end of Dolphin's
# own top-level directory (cmake/inject.cmake), after its targets exist.
bun_emu_add_plugin(dolphin)
target_sources(${BUN_EMU_PLUGIN} PRIVATE "${BUN_EMU_HOST_DIR}/src/dolphin/dolphin_core.cpp")
bun_emu_inherit_directory(${BUN_EMU_PLUGIN} "${CMAKE_SOURCE_DIR}/Source")
# Same link set as DolphinNoGUI: Core pulls VideoCommon, the video backends,
# AudioCommon, InputCommon, DiscIO and Common.
target_link_libraries(${BUN_EMU_PLUGIN} PRIVATE core uicommon)
if(MSVC)
  # Dolphin builds with /W4 /WX /GR-; keep its ABI (no RTTI) but not its warning policy.
  target_compile_options(${BUN_EMU_PLUGIN} PRIVATE /WX- /W3)
endif()
# Dolphin's Sys data (game INIs, fonts, shaders) next to the plugin. Dolphin
# looks for Sys beside the executable, then in DATA_DIR: the host executable is
# not Dolphin, so DATA_DIR of FileUtil.cpp (only) points at the staged copy.
set_property(SOURCE "${CMAKE_SOURCE_DIR}/Source/Core/Common/FileUtil.cpp" TARGET_DIRECTORY common
  APPEND PROPERTY COMPILE_DEFINITIONS "DATA_DIR=\"${BUN_EMU_HOST_OUTPUT_DIR}/dolphin/\"")
# The shared PCH was built with the original DATA_DIR: compile this file without it (/Y-).
set_property(SOURCE "${CMAKE_SOURCE_DIR}/Source/Core/Common/FileUtil.cpp" TARGET_DIRECTORY common
  APPEND PROPERTY COMPILE_OPTIONS /Y-)
add_custom_command(TARGET ${BUN_EMU_PLUGIN} POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_SOURCE_DIR}/Data/Sys" "${BUN_EMU_HOST_OUTPUT_DIR}/dolphin/Sys")
