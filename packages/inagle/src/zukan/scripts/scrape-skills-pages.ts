import { WebCdpPage, waitForSelector } from "../web-cdp";
import fs from "node:fs";
import { join } from "node:path";

async function main() {
  console.log("[Scrape Skills] Starting browser...");
  const page = await WebCdpPage.connect();
  try {
    const destDir = join(import.meta.dir, "../../../data/zukan/skill");
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    for (let pageNum = 1; pageNum <= 5; pageNum++) {
      const url = `https://zukan.inazuma.jp/en/skill/?page=${pageNum}&per_page=200`;
      console.log(`[Scrape Skills] Navigating to page ${pageNum} : ${url}`);

      try {
        await page.goto(url);
        // Wait for the skillListBox to render
        await waitForSelector(page, "ul.skillListBox", 15000).catch(() => {});

        // Wait a bit for the content to fully load/render
        await new Promise((r) => setTimeout(r, 4000));

        const content = await page.content();
        const filePath = join(destDir, `page-${pageNum}.html`);
        fs.writeFileSync(filePath, content, "utf-8");
        console.log(`[Scrape Skills] Successfully saved ${filePath} (${content.length} bytes)`);
      } catch (e) {
        console.error(`[Scrape Skills] Failed to scrape page ${pageNum}:`, e);
      }
    }

    console.log("[Scrape Skills] Done!");
  } finally {
    await page.close().catch(() => undefined);
  }
}

main().catch(console.error);
