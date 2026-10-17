# Azahar (vendor/azahar, GPL-2.0-or-later): evaluated at the end of Azahar's
# top-level directory (cmake/inject.cmake), after its targets exist.
bun_emu_add_plugin(azahar)
target_sources(${BUN_EMU_PLUGIN} PRIVATE "${BUN_EMU_HOST_DIR}/src/azahar/azahar_core.cpp")
bun_emu_inherit_directory(${BUN_EMU_PLUGIN} "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(${BUN_EMU_PLUGIN} PRIVATE citra_common citra_core video_core audio_core Boost::boost)
if(MSVC)
  target_compile_options(${BUN_EMU_PLUGIN} PRIVATE /WX-)
endif()
