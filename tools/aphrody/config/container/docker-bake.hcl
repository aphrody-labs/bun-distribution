# SPDX-License-Identifier: Apache-2.0
# Buildx Bake definition of the Aphrody images. From the repository root:
#   docker buildx bake -f tools/config/container/docker-bake.hcl            # runtime image (default group)
#   docker buildx bake -f tools/config/container/docker-bake.hcl all        # runtime + dev + wasm artifacts
variable "TAG" { default = "runtime" }
variable "APHRODY_RELEASE" { default = "" }

group "default" { targets = ["runtime"] }
group "all" { targets = ["runtime", "dev", "wasm-artifacts"] }

target "_common" {
  context    = "."
  dockerfile = "tools/config/container/Dockerfile"
  args       = { APHRODY_RELEASE = APHRODY_RELEASE }
}

target "runtime" {
  inherits = ["_common"]
  target   = "runtime"
  tags     = ["aphrody:${TAG}", "aphrody:runtime"]
}

target "dev" {
  inherits = ["_common"]
  target   = "dev"
  tags     = ["aphrody:dev"]
}

target "wasm-artifacts" {
  inherits = ["_common"]
  target   = "wasm-artifacts"
  output   = ["type=local,dest=dist/container-wasm"]
}
