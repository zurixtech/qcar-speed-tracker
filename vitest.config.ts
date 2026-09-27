import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      // Estos modulos necesitan DOM o TF.js real (canvas, video, audio,
      // rAF/rVFC); los tests unitarios son codigo puro, asi que quedan
      // afuera del umbral en vez de contarse como sin cobertura.
      exclude: ["lib/detector.ts", "lib/draw.ts", "lib/audio.ts", "lib/frames.ts"],
      // Medido en 86/89/91/86 (lines/branches/functions/stmts) al escribir
      // esto; el umbral queda un poco debajo para no romper con variaciones
      // chicas y todavia detectar una caida real de cobertura.
      thresholds: {
        lines: 82,
        branches: 85,
        functions: 85,
        statements: 82,
      },
    },
  },
});
