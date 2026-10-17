// Header types inferred from the parsers, used by the typed `import rom from "./x.nes"` declarations.
import type { parseElf } from "./parsers/elf.js";
import type { parseFds, parseGameBoy, parseGba, parseNds, parseNes } from "./parsers/handheld.js";
import type { parseDisc, parseDol, parseN64, parseWbfs, parseWia } from "./parsers/home.js";
import type { parseGenesis } from "./parsers/sega.js";

type HeaderOf<Parser extends (...args: never[]) => Promise<{ header: object }>> = Awaited<ReturnType<Parser>>["header"];

export type NesHeader = HeaderOf<typeof parseNes>;
export type FdsHeader = HeaderOf<typeof parseFds>;
export type GameBoyHeader = HeaderOf<typeof parseGameBoy>;
export type GbaHeader = HeaderOf<typeof parseGba>;
export type NdsHeader = HeaderOf<typeof parseNds>;
export type N64Header = HeaderOf<typeof parseN64>;
export type DolHeader = HeaderOf<typeof parseDol>;
export type ElfHeader = HeaderOf<typeof parseElf>;
export type DiscHeader = HeaderOf<typeof parseDisc>;
export type WbfsHeader = HeaderOf<typeof parseWbfs>;
export type WiaHeader = HeaderOf<typeof parseWia>;
export type GenesisHeader = HeaderOf<typeof parseGenesis>;
