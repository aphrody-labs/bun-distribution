cmake_minimum_required(VERSION 3.25)
project(bun_engine LANGUAGES C CXX)

add_library(bun_engine_ffi INTERFACE)
target_include_directories(bun_engine_ffi INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_compile_features(bun_engine_ffi INTERFACE c_std_17 cxx_std_20)

option(BUN_ENGINE_DIRECTX12 "Expose the pinned DirectX 12 headers" ON)
option(BUN_ENGINE_CUDA "Expose pinned CUDA C++ core headers" OFF)

if(BUN_ENGINE_DIRECTX12)
  add_library(bun_engine_directx12 INTERFACE)
  target_include_directories(bun_engine_directx12 INTERFACE
    "${CMAKE_CURRENT_SOURCE_DIR}/../../vendor/directx-headers/include")
endif()

if(BUN_ENGINE_CUDA)
  add_library(bun_engine_cuda INTERFACE)
  target_include_directories(bun_engine_cuda INTERFACE
    "${CMAKE_CURRENT_SOURCE_DIR}/../../vendor/cuda-cccl/libcudacxx/include"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../vendor/cuda-cccl/cub")
endif()
