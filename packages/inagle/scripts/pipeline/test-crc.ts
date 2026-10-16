import { crc32Hex } from "../../src/core/hash.ts";

const labels = ["TEXT_INFO_8", "TEXT_INFO_0", "TEXT_INFO_1", "TEXT_INFO_2"];
labels.forEach(l => {
  console.log(`${l}: ${crc32Hex(l)}`);
});
