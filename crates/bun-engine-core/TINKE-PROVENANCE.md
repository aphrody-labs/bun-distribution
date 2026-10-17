# Tinke core provenance

- Upstream: https://github.com/pleonex/tinke
- Aphrody fork: https://github.com/aphrody-labs/tinke
- Upstream branch: `master`
- License: GPL-3.0
- Imported behavior: block encryption/decryption from
  `Plugins/INAZUMA11/INAZUMA11/Encryption.cs` and bounded PAC header counting
  from `Plugins/INAZUMA11/INAZUMA11/Packs.cs`.

The Windows Forms GUI, designer resources, plugin host, dynamic plugin loading
and .NET Framework project files are deliberately excluded. The replacement is
a .NET 10 NativeAOT shared library with a C ABI for Bun FFI. This directory is
the future single Nintendo DS owner; Dust, libnds and IECODE migrations must
converge here without embedding private ROM data.
