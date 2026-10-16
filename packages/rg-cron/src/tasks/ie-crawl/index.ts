/**
 * Les collectes externes ont été retirées de production : aucun navigateur,
 * crawler ou scraper ne doit être relancé depuis rg-cron.
 */
export async function runIeCrawl(): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: "Les crawlers externes sont désinstallés." };
}
