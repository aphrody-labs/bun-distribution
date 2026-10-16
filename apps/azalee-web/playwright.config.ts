import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: 120_000,
  use: {
    baseURL: process.env.AZALEE_E2E_BASE_URL ?? "http://127.0.0.1:3107",
    browserName: "chromium",
    headless: true,
    serviceWorkers: "block",
    launchOptions: { executablePath: "/usr/local/bin/chromium" },
    trace: "retain-on-failure",
  },
});
