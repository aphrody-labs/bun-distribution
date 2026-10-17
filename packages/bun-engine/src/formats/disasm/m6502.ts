// Built-in MOS 6502 / Ricoh 2A03 disassembler (official opcodes); used when MAME's unidasm is
// not installed so NES images stay disassemblable from the single-file executable.
import type { DisasmLine } from "./index";

type Mode =
  | "imp"
  | "acc"
  | "imm"
  | "zp"
  | "zpx"
  | "zpy"
  | "abs"
  | "abx"
  | "aby"
  | "ind"
  | "izx"
  | "izy"
  | "rel";

const lengths: Record<Mode, number> = {
  imp: 1,
  acc: 1,
  imm: 2,
  zp: 2,
  zpx: 2,
  zpy: 2,
  abs: 3,
  abx: 3,
  aby: 3,
  ind: 3,
  izx: 2,
  izy: 2,
  rel: 2,
};

// "mnemonic mode" per opcode, grouped as the classic aaabbbcc table rows.
const table = `
00 brk imp|01 ora izx|05 ora zp|06 asl zp|08 php imp|09 ora imm|0a asl acc|0d ora abs|0e asl abs
10 bpl rel|11 ora izy|15 ora zpx|16 asl zpx|18 clc imp|19 ora aby|1d ora abx|1e asl abx
20 jsr abs|21 and izx|24 bit zp|25 and zp|26 rol zp|28 plp imp|29 and imm|2a rol acc|2c bit abs|2d and abs|2e rol abs
30 bmi rel|31 and izy|35 and zpx|36 rol zpx|38 sec imp|39 and aby|3d and abx|3e rol abx
40 rti imp|41 eor izx|45 eor zp|46 lsr zp|48 pha imp|49 eor imm|4a lsr acc|4c jmp abs|4d eor abs|4e lsr abs
50 bvc rel|51 eor izy|55 eor zpx|56 lsr zpx|58 cli imp|59 eor aby|5d eor abx|5e lsr abx
60 rts imp|61 adc izx|65 adc zp|66 ror zp|68 pla imp|69 adc imm|6a ror acc|6c jmp ind|6d adc abs|6e ror abs
70 bvs rel|71 adc izy|75 adc zpx|76 ror zpx|78 sei imp|79 adc aby|7d adc abx|7e ror abx
81 sta izx|84 sty zp|85 sta zp|86 stx zp|88 dey imp|8a txa imp|8c sty abs|8d sta abs|8e stx abs
90 bcc rel|91 sta izy|94 sty zpx|95 sta zpx|96 stx zpy|98 tya imp|99 sta aby|9a txs imp|9d sta abx
a0 ldy imm|a1 lda izx|a2 ldx imm|a4 ldy zp|a5 lda zp|a6 ldx zp|a8 tay imp|a9 lda imm|aa tax imp|ac ldy abs|ad lda abs|ae ldx abs
b0 bcs rel|b1 lda izy|b4 ldy zpx|b5 lda zpx|b6 ldx zpy|b8 clv imp|b9 lda aby|ba tsx imp|bc ldy abx|bd lda abx|be ldx aby
c0 cpy imm|c1 cmp izx|c4 cpy zp|c5 cmp zp|c6 dec zp|c8 iny imp|c9 cmp imm|ca dex imp|cc cpy abs|cd cmp abs|ce dec abs
d0 bne rel|d1 cmp izy|d5 cmp zpx|d6 dec zpx|d8 cld imp|d9 cmp aby|dd cmp abx|de dec abx
e0 cpx imm|e1 sbc izx|e4 cpx zp|e5 sbc zp|e6 inc zp|e8 inx imp|e9 sbc imm|ea nop imp|ec cpx abs|ed sbc abs|ee inc abs
f0 beq rel|f1 sbc izy|f5 sbc zpx|f6 inc zpx|f8 sed imp|f9 sbc aby|fd sbc abx|fe inc abx`;

const opcodes = new Map<number, [string, Mode]>();
for (const entry of table.split(/[|\n]/)) {
  const [code, mnemonic, mode] = entry.trim().split(" ");
  if (code) opcodes.set(Number.parseInt(code, 16), [mnemonic, mode as Mode]);
}

const h2 = (value: number) => value.toString(16).padStart(2, "0");
const h4 = (value: number) => value.toString(16).padStart(4, "0");

function operand(
  mode: Mode,
  bytes: Uint8Array,
  at: number,
  pc: number,
): string {
  const b = bytes[at + 1] ?? 0;
  const w = b | ((bytes[at + 2] ?? 0) << 8);
  switch (mode) {
    case "imp":
      return "";
    case "acc":
      return "a";
    case "imm":
      return `#$${h2(b)}`;
    case "zp":
      return `$${h2(b)}`;
    case "zpx":
      return `$${h2(b)},x`;
    case "zpy":
      return `$${h2(b)},y`;
    case "abs":
      return `$${h4(w)}`;
    case "abx":
      return `$${h4(w)},x`;
    case "aby":
      return `$${h4(w)},y`;
    case "ind":
      return `($${h4(w)})`;
    case "izx":
      return `($${h2(b)},x)`;
    case "izy":
      return `($${h2(b)}),y`;
    case "rel":
      return `$${h4((pc + 2 + ((b << 24) >> 24)) & 0xffff)}`;
  }
}

export function disassemble6502(
  bytes: Uint8Array,
  address: number,
  count: number,
): DisasmLine[] {
  const lines: DisasmLine[] = [];
  for (let at = 0; at < bytes.byteLength && lines.length < count;) {
    const pc = (address + at) & 0xffff;
    const known = opcodes.get(bytes[at]);
    const length = known ? lengths[known[1]] : 1;
    if (at + length > bytes.byteLength) break;
    const text = known
      ? `${known[0]} ${operand(known[1], bytes, at, pc)}`.trim()
      : `.db $${h2(bytes[at])}`;
    lines.push({
      address: pc,
      bytes: Array.from(bytes.subarray(at, at + length), h2).join(" "),
      text,
    });
    at += length;
  }
  return lines;
}
