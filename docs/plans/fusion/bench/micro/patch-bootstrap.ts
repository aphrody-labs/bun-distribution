// Génère la copie de bootstrap.js évaluée par le banc B3 : une seule ligne change (celle qui masque `Performance*` dans le
// global), parce que `Object.defineProperty(globalThis, nom, { enumerable: false })` sans valeur remplace la valeur par
// `undefined` dans les contextes node:vm de Deno ; la copie conserve la valeur et les attributs. Identique pour les deux moteurs.
//   bun patch-bootstrap.ts <bootstrap.js> <sortie.js>
const [src, out] = process.argv.slice(2);
const orig = await Bun.file(src!).text();
const re = /Object\.defineProperty\(globalThis, (\w+), \{ ?enumerable: ?false ?\}\)/g;
const n = [...orig.matchAll(re)].length;
if (n !== 1) throw new Error(`attendu 1 occurrence, trouvé ${n}`);
const patched = orig.replace(
  re,
  "Object.defineProperty(globalThis, $1, {enumerable: false, value: globalThis[$1], writable: true, configurable: true})",
);
await Bun.write(out!, patched);
const h = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex").slice(0, 16);
console.log(
  JSON.stringify({
    originalSha256: h(orig),
    patchedSha256: h(patched),
    originalLines: orig.split("\n").length,
  }),
);
