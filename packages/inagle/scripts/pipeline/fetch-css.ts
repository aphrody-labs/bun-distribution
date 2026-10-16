/* eslint-disable no-console */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const CSS_URLS = [
  "https://dxi4wb638ujep.cloudfront.net/1/prd/assets/4/css/base.css",
  "https://dxi4wb638ujep.cloudfront.net/1/prd/assets/4/css/shared.css",
  "https://dxi4wb638ujep.cloudfront.net/1/prd/assets/4/css/style.css",
];

async function main() {
  for (const url of CSS_URLS) {
    console.log(`Fetching ${url}...`);
    const res = await fetch(url);
    const text = await res.text();
    const filename = url.split("/").pop();
    await writeFile(join(process.cwd(), "data/zukan-css", filename!), text);
  }
}

main().catch(console.error);
