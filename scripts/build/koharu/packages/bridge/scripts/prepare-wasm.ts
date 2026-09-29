import { join } from 'node:path'

// wasm-pack ignores its generated folder in Git; Bun pack must include its payload.
await Bun.write(join(import.meta.dir, '..', 'src', 'wasm', '.npmignore'), '# distribute generated WebGPU canvas\n')
