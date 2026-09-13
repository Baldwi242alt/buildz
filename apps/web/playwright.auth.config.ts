import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./auth-tests",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "auth-test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "auth-playwright-report", open: "never" }],
  ],
  webServer: {
    command: "npm run dev -- --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    env: {
      VITE_BUILDZ_AUTH_URL: "https://buildz-auth.example.test",
      VITE_BUILDZ_AUTH_PUBLISHABLE_KEY:
        "sb_publishable_browser_test_not_a_secret",
      VITE_BUILDZ_LOCAL_DEMO: "false",
    },
  },
});
