import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser", timeout: 30000, fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:8765", trace: "retain-on-failure" },
  webServer: { command: "node tests/browser/server.mjs", url: "http://127.0.0.1:8765/tests/browser/probe.html", reuseExistingServer: false },
  projects: [{ name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "android-emulated", use: { ...devices["Pixel 7"] } }],
});
