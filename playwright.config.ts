import { defineConfig, devices } from "@playwright/test";

const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://ff:ff@localhost:5432/family_finance_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: "http://localhost:3100", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: E2E_DB,
      AUTH_SECRET: "e2e-only-secret-not-for-production-000000",
      AUTH_URL: "http://localhost:3100",
      AUTH_GOOGLE_ID: "e2e-placeholder",
      AUTH_GOOGLE_SECRET: "e2e-placeholder",
      HOUSEHOLD_ADMIN_EMAIL: "erik@example.test",
      AUTH_TEST_MODE: "true",
      DEMO_MODE: "false",
      CUE_FLOW_AUTHORIZED: "false",
    },
  },
});
