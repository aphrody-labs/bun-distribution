import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const currentDir = dirname(fileURLToPath(import.meta.url)),
      ROOT = join(currentDir, '../..');

// Read version from Cargo.toml
const cargoTomlPath = join(ROOT, 'packages/tauri-plugin-mcp-bridge/Cargo.toml'),
      cargoToml = readFileSync(cargoTomlPath, 'utf-8'),
      versionMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);

if (!versionMatch) {
   throw new Error('Could not find version in Cargo.toml');
}

const fullVersion = versionMatch[1],
      [ major, minor ] = fullVersion.split('.'),
      cargoVersion = `${major}.${minor}`;

export default {
   load() {
      return {
         plugin: {
            full: fullVersion,
            cargo: cargoVersion,
         },
      };
   },
};
