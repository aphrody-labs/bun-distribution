<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
# Spacedrive Drive adapter sources

The Python adapter scripts in `adapters/` are retained upstream source from the
Spacedrive Drive backend imported by Aphrody OS. They speak the Spacedrive
adapter protocol and are consumed by the Rust Drive runtime; they are not part
of the Aphrody Python SDK API.

The original project is [spacedriveapp/spacedrive](https://github.com/spacedriveapp/spacedrive).
The imported backend snapshot is documented in the Aphrody OS Drive workspace
and licensed under [FSL-1.1-ALv2](LICENSE), separately from Aphrody's
Apache-2.0 code. Source and target hashes are recorded in
[`docs/migration/python-import-manifest.json`](../../../docs/migration/python-import-manifest.json).

Keep this source copy aligned with that manifest. Changes to adapter behavior
belong in the Aphrody OS Drive backend and must preserve its runtime protocol.
