const text = await Bun.file("/tmp/test_data.json").text();
const data = JSON.parse(text);
const count = data.filter((x: any) => x.active && x.score > 50).length;
