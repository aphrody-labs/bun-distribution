# nie.exe Reverse Engineering Specification

> Comprehensive, authoritative disassembly reference for `nie.exe` (Inazuma Eleven: Victory Road).
> Based on static PE32+ analysis, .pdata exception directory boundary mapping, and runtime memory inspection.

---

## 1. Binary Characteristics

- **Target Executable**: `nie.exe` (Internal file name: `nie1v2.exe`)
- **Format**: PE32+ (64-bit Windows Executable)
- **Architecture**: x86_64
- **Image Base**: `0x140000000`
- **Total Function Entries**: **117,068** (extracted from `.pdata` function entry table)

---

## 2. Cryptographic Constants & Polynomials

| Constant Name               | Hexadecimal  | Integer      | Status      | Algorithmic Usage                                                                                          |
| --------------------------- | ------------ | ------------ | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `VIOLA_FIXED_KEY`           | `0x1717E18E` | `387441038`  | ✅ Verified | Fixed CRI XOR encryption key for cpk_list.cfg.bin and standalone Level-5 packages (discovered by Viola).   |
| `LEVEL5_CRC32_POLYNOMIAL`   | `0xEDB88320` | `3988292384` | ✅ Verified | Standard IEEE 802.3 reflected CRC32 polynomial for RDBN hash dictionaries and CPK filename key derivation. |
| `CRI_ENCRYPTED_TABLE_MAGIC` | `0xF5F39E1F` | `4126383647` | ✅ Verified | Magic header sentinel indicating an encrypted CRI @UTF table block.                                        |
| `LIVES_SAVE_HEADER_MAGIC`   | `0x9DCE66C3` | `2647549635` | ✅ Verified | Sentinel u32 LE placed at offset 0x00 of decrypted Lives save containers (002AB8F4-*).                     |
| `LIVES_SAVE_CONST2`         | `0x2EC3031F` | `784532255`  | ✅ Verified | Constant u32 LE at offset 0x08 of decrypted Lives save header (bytes: 1F 03 C3 2E).                        |
| `LIVES_BLOB_MAGIC`          | `0xEEFF`     | `61183`      | ✅ Verified | Big-endian u16 sentinel starting every concatenated payload blob in Lives saves.                           |
| `STEAM_APP_ID`              | `0x2AB8F4`   | `2799860`    | ✅ Verified | Official Steam App ID for Inazuma Eleven: Victory Road (hexadecimal prefix for save files: 002AB8F4).      |

---

## 3. Critical Function Offsets & Entry Points

| Symbol Name                  | Disassembly Address | Subsystem    | Calling Conv | Signature                                                                                                     | Functional Description                                                                                        |
| ---------------------------- | ------------------- | ------------ | ------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **GameTickLoop**             | `0x1406d5840`       | `game-loop`  | `__fastcall` | `void __fastcall GameTickLoop(void* engineContext, float deltaTime)`                                          | Main game tick loop orchestrating 60 Hz physics update, animation blending, and entity state synchronization. |
| **CharaControllerUpdate**    | `0x1404ecd60`       | `controller` | `__fastcall` | `void __fastcall CharaControllerUpdate(void* playerEntity, void* inputState, float dt)`                       | Player movement, kinematic resolution, ball possession calculations, and user input mapping.                  |
| **CriFsStreamDecryptBlock**  | `0x1405a1120`       | `crypto`     | `__fastcall` | `void __fastcall CriFsStreamDecryptBlock(uint8_t* buffer, size_t length, uint64_t fileOffset, uint32_t key)`  | Position-aware XOR stream cipher implementation decrypting 4-byte quads based on file offset.                 |
| **CriLaylaDecompressStream** | `0x1405b3890`       | `vfs`        | `__fastcall` | `int32_t __fastcall CriLaylaDecompressStream(const uint8_t* input, uint8_t* output, size_t uncompressedSize)` | Reverse bitstream LZSS decompressor processing byte-by-byte from end of stream into preallocated buffer.      |
| **RdbnTableLookup**          | `0x1403c8040`       | `vfs`        | `__fastcall` | `void* __fastcall RdbnTableLookup(const uint8_t* rdbnBuffer, uint32_t tableHash, uint32_t entryHash)`         | Binary search in RDBN table header resolving 32-bit CRC hashes to column offsets and row pointers.            |
| **G4txDecodeTexture**        | `0x1404b2a80`       | `render`     | `__fastcall` | `void* __fastcall G4txDecodeTexture(const uint8_t* g4txData, size_t dataSize, int32_t textureIndex)`          | G4TX header parsing, DDS texture extraction, and GPU resource registration.                                   |
| **LuaHostInit**              | `0x14072f910`       | `lua`        | `__fastcall` | `void* __fastcall LuaHostInit(void* memoryPool)`                                                              | Initializes Lua 5.1/5.2 C host environment for UI animations, dialogue branching, and menu state machines.    |
| **CRand_MT19937_Next**       | `0x14081c200`       | `prng`       | `__fastcall` | `uint32_t __fastcall CRand_MT19937_Next(void* crandState)`                                                    | Deterministic Mersenne Twister MT19937 pseudorandom number generator step function.                           |

---

## 4. Polymorphic RTTI Class Hierarchy

| Class (Fully Qualified)         | VTable Offset | Inheritance Base         | Subsystem Description                                                                                  |
| ------------------------------- | ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `Level5::Engine::Object`        | `0x140AC4000` | `None`                   | Polymorphic base class for all engine actors, components, and resource handles.                        |
| `Level5::Game::CharaController` | `0x140AC68A0` | `Level5::Engine::Object` | High-level player controller managing motion states (dash, dribble, slide tackle, shoot charge).       |
| `Level5::Game::BallPhysics`     | `0x140AC7120` | `Level5::Engine::Object` | Aerodynamic and turf friction simulation for the soccer ball, including spin and pass trajectories.    |
| `Level5::Resource::VfsManager`  | `0x140AD1400` | `Level5::Engine::Object` | Global filesystem coordinator mounting CPK pack archives and routing relative logical paths.           |
| `Level5::Resource::CpkArchive`  | `0x140AD2200` | `Level5::Engine::Object` | CRI Middleware CPK container handle with memory-mapped file views and decryption context.              |
| `Level5::Graphics::RenderScene` | `0x140AE0100` | `Level5::Engine::Object` | Scene graph renderer managing camera viewports, shadow cascades, and lighting buffers.                 |
| `Level5::Graphics::SkinnedMesh` | `0x140AE1880` | `Level5::Engine::Object` | GPU skinning mesh processor packing 32 bones into 96 vec4 matrix registers (renderObj + 0x1D98).       |
| `CriWare::Atom::SoundPlayer`    | `0x140AF4900` | `None`                   | CRI Atom Craft sound playback service managing voice categories, BGM ducking, and 3D positional audio. |

---

## 5. Critical Memory Structures

### `BonePalette` (Size: `0x600`)

_Uniform buffer layout for skinned character meshes (32 bones × 3 vec4 matrices = 96 vec4, 1536 bytes)._

- `0x000..0x600`: Array of 32 mat3x4 (row-major affine transforms without homogeneous row [0,0,0,1]).

### `FontGlyph` (Size: `0x0C`)

_Single glyph descriptor in Level-5 font texture atlas._

- `0x00`: uint16_t u (atlas X coordinate)
- `0x02`: uint16_t v (atlas Y coordinate)
- `0x04`: uint8_t width
- `0x05`: uint8_t height
- `0x06`: int8_t offsetX
- `0x07`: int8_t offsetY
- `0x08`: int8_t advanceX
- `0x09`: uint8_t pageIndex (0 to 3)
- `0x0A`: uint16_t reserved/padding

### `RdbnHeader` (Size: `0x50`)

_RDBN / cfg.bin 80-byte file header descriptor._

- `0x00..0x04`: uint32_t magic = 0x4E424452 ('RDBN')
- `0x04..0x06`: uint16_t headerSize = 0x50
- `0x06..0x0A`: uint32_t version = 0x01
- `0x0A..0x0E`: uint32_t tableCount
- `0x0E..0x12`: uint32_t stringPoolSize
- `0x12..0x16`: uint32_t dataSectionSize
- `0x16..0x50`: CRC32 checksums, schema flags, and table offset descriptors
