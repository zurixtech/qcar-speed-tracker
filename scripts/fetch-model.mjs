#!/usr/bin/env node
/**
 * Descarga los pesos de COCO-SSD a `public/models/` para servirlos desde el
 * mismo origen que la app.
 *
 * Sirve para dos cosas:
 *  - que la app funcione en redes que bloquean el CDN de Google (y para que los
 *    tests end-to-end no dependan de internet);
 *  - que la primera carga no dependa de un tercero.
 *
 * Si no corres este script no pasa nada: la app detecta que no hay modelo local
 * y cae al CDN, que es el comportamiento por defecto de la libreria.
 *
 *   node scripts/fetch-model.mjs [lite_mobilenet_v2|mobilenet_v2] ...
 */
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://storage.googleapis.com/tfjs-models/savedmodel";
const PREFIX = {
  lite_mobilenet_v2: "ssdlite_mobilenet_v2",
  mobilenet_v2: "ssd_mobilenet_v2",
};

const OUT_ROOT = path.join(process.cwd(), "public", "models", "coco-ssd");

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} al bajar ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

async function fetchVariant(variant) {
  const prefix = PREFIX[variant];
  if (!prefix) throw new Error(`Variante desconocida: ${variant}`);

  const outDir = path.join(OUT_ROOT, variant);
  await mkdir(outDir, { recursive: true });

  const manifestPath = path.join(outDir, "model.json");
  if (!(await exists(manifestPath))) {
    const bytes = await download(`${BASE_URL}/${prefix}/model.json`, manifestPath);
    console.log(`  model.json  ${(bytes / 1024).toFixed(0)} KB`);
  } else {
    console.log("  model.json  (ya estaba)");
  }

  // Los shards se listan en el manifiesto, con rutas relativas a model.json.
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const shards = manifest.weightsManifest.flatMap((group) => group.paths);

  let total = 0;
  for (const shard of shards) {
    const dest = path.join(outDir, shard);
    if (await exists(dest)) {
      console.log(`  ${shard}  (ya estaba)`);
      continue;
    }
    const bytes = await download(`${BASE_URL}/${prefix}/${shard}`, dest);
    total += bytes;
    console.log(`  ${shard}  ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  }

  console.log(
    total > 0
      ? `✓ ${variant}: ${(total / 1024 / 1024).toFixed(1)} MB en public/models/coco-ssd/${variant}`
      : `✓ ${variant}: ya estaba completo`,
  );
}

const variants = process.argv.slice(2);
for (const variant of variants.length > 0 ? variants : ["lite_mobilenet_v2"]) {
  console.log(`Descargando ${variant}…`);
  await fetchVariant(variant);
}
