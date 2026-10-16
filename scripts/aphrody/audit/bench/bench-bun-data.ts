// SPDX-License-Identifier: Apache-2.0
const text = await Bun.file("/tmp/test_data.json").text();
const data = JSON.parse(text);
const count = data.filter(
  (x: { active: boolean; score: number }) => x.active && x.score > 50,
).length;
console.log(count);
