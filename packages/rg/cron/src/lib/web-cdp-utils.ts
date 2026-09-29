export interface DomEvaluator {
  evaluate<T>(script: string): Promise<T>;
}

export async function waitForSelector(
  page: DomEvaluator,
  selector: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const expression = `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
  while (Date.now() < deadline) {
    if (await page.evaluate<boolean>(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Selector ${JSON.stringify(selector)} was not found within ${timeoutMs} ms`);
}
