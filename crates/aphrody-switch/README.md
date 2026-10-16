# Portable Switch primitives

The `texture` module owns checked Tegra GOB block-linear byte addressing and
caller-buffer swizzle/unswizzle, without dependencies, allocation or unsafe code.
Source: retained `crates/emu/ruzu/video_core/src/textures/decoders.rs`, carrying
`SPDX-FileCopyrightText: 2025 ruzu contributors` and GPL-2.0-or-later. These
identifiers are preserved; the retained repository-level license document is
GPLv3 and must not be interpreted as changing that source-file license.

The sector mapping matches the PDEP masks in retained source and the NVIDIA
64-by-8-byte GOB layout. Dimensions are elements, including compressed-format
blocks. Padding is untouched. Buffers are validated before mutation; malformed
dimensions return errors rather than wrapping address calculations.

Reference: https://developer.nvidia.com/docs/drive/drive-os/7.2.5/public/drive-os-linux-sdk-api-ref-ea/group__nvrm__surface__api__fusa.html

This is texture-layout logic, not Maxwell shaders, a GPU command processor,
Switch boot, or complete emulation.
