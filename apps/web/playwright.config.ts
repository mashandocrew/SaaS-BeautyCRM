import { defineConfig, devices } from "@playwright/test"
import { config as loadEnv } from "dotenv"
import path from "node:path"

loadEnv({ path: path.resolve(__dirname, ".env.local") })

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  // Next dev compila cada ruta on-demand la primera vez: en máquinas
  // Windows con pnpm esto puede tardar 20-30s por ruta. El timeout largo
  // es para absorber eso, no porque la app en sí sea lenta.
  timeout: 90_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
})
