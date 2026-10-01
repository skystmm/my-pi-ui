import { defineConfig } from "@playwright/test"
import { join } from "node:path"

const runtime = join(process.cwd(), ".e2e-runtime")

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5273", browserName: "chromium", channel: process.env.PI_UI_E2E_CHROME_CHANNEL === "chrome" ? "chrome" : undefined },
  webServer: [
    {
      command: "npm run dev --prefix shell-service",
      url: "http://127.0.0.1:5274/health",
      reuseExistingServer: false,
      env: {
        PI_UI_PORT: "5274",
        PI_UI_ORIGINS: "http://127.0.0.1:5273",
        PI_CODING_AGENT_DIR: join(runtime, "agent"),
      },
      timeout: 30_000,
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:5273",
      reuseExistingServer: false,
      env: { PI_UI_WEB_PORT: "5273", PI_UI_PORT: "5274" },
      timeout: 30_000,
    },
  ],
})
