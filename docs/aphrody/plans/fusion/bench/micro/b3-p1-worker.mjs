// Banc B3, sonde P1 : charge de travail d'un « script de page hostile » qui alloue sans fin dans un Worker.
// Le fil principal sonde le RSS du processus et arrête le Worker (terminate) au-delà du plafond.
let keep = [];
postMessage("started");
for (;;) {
  const chunk = [];
  chunk.length = 100000;
  keep.push(chunk.fill(1));
  if (keep.length > 1e9) keep = [];
}
