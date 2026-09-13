import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Asegura que los pesos de COCO-SSD esten servidos por la propia app antes de
 * correr los tests: asi el pipeline no depende del CDN de Google ni de que el
 * navegador de CI tenga salida a internet.
 */
export default function globalSetup(): void {
  const root = path.join(__dirname, "..", "..");
  const manifest = path.join(root, "public", "models", "coco-ssd", "lite_mobilenet_v2", "model.json");
  if (existsSync(manifest)) return;

  console.log("[e2e] descargando los pesos del modelo (solo la primera vez)…");
  execFileSync("node", [path.join(root, "scripts", "fetch-model.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
}
