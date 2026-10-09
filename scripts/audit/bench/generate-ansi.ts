// SPDX-License-Identifier: Apache-2.0
// Generates a 100k-line file of ANSI terminal escape sequences (colors, 256-color, truecolor, SGR, cursor)

const chunks: string[] = [];
const lines = 100_000;

for (let i = 0; i < lines; i++) {
  const r = (i * 37) % 256;
  const g = (i * 59) % 256;
  const b = (i * 83) % 256;
  const sgr = i % 4 === 0 ? "\x1b[1m" : i % 4 === 1 ? "\x1b[3m" : i % 4 === 2 ? "\x1b[4m" : "\x1b[0m";
  chunks.push(`${sgr}\x1b[38;2;${r};${g};${b}m[line ${i.toString().padStart(6, "0")}]\x1b[0m \x1b[48;5;${(i % 16) + 16}m Aphrody Terminal Stream Test \x1b[0m\n`);
}

await Bun.write("/tmp/ansi_stream.txt", chunks.join(""));
console.log(`Generated /tmp/ansi_stream.txt (${(await Bun.file("/tmp/ansi_stream.txt").size / (1024 * 1024)).toFixed(2)} MB)`);
