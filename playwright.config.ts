import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // El modelo de deteccion se baja del CDN y corre inferencia: los tests del
  // pipeline completo necesitan mucho mas tiempo que un e2e de UI normal.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            // WebGL por software: en headless no hay GPU, pero TF.js igual
            // encuentra un backend WebGL valido.
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            // Los videos de prueba tienen que arrancar sin gesto del usuario.
            "--autoplay-policy=no-user-gesture-required",
            // Camara sintetica, para probar el camino de getUserMedia.
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run start`,
    url: BASE_URL,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
    stdout: "pipe",
    stderr: "pipe",
  },
});
