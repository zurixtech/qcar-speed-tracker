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
 * Se corre como "prebuild" (ver package.json), asi el build de produccion
 * siempre intenta empaquetar el modelo local. No corta el build si no hay
 * red: si falta algun archivo, la app cae al CDN en tiempo de ejecucion (ver
 * lib/detector.ts), asi que esto solo avisa por consola y sigue.
 *
 *   node scripts/fetch-model.mjs [lite_mobilenet_v2|mobilenet_v2] ...
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const BASE_URL = "https://storage.googleapis.com/tfjs-models/savedmodel";
const PREFIX = {
  lite_mobilenet_v2: "ssdlite_mobilenet_v2",
  mobilenet_v2: "ssd_mobilenet_v2",
};

// Tamano y sha256 de los pesos conocidos, para detectar una descarga
// truncada o corrompida. Solo cubre la variante que usamos por defecto; una
// variante sin entrada simplemente no se verifica.
const KNOWN_HASHES = {
  lite_mobilenet_v2: {
    "model.json": { size: 527315, sha256: "3770b2528339b1e3340cb74360e1e40401816b009779aeb8d0cce3a4353ea3a9" },
    "group1-shard1of5": { size: 4194304, sha256: "0e7af0f713e98521252321f7f84892c31cefccccec3ac64c84e5065b75ed5646" },
    "group1-shard2of5": { size: 4194304, sha256: "74cc6cfc2c4510c9cd81b8ad4cebf6f6a8f305119bb365ce0eb96276da38519a" },
    "group1-shard3of5": { size: 4194304, sha256: "50383033f893eae136392a403e8f70ade5efd90867df5695c4ca5ac640e14f38" },
    "group1-shard4of5": { size: 4194304, sha256: "d856dc534c780068bbf6c666ce1516df2c8433d87578aa31fcdf197de7058cc2" },
    "group1-shard5of5": { size: 1257312, sha256: "3d356f1fb6dfca6af78c56db34d9326706d0196e303f9de6b04f236ca79ed309" },
  },
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

async function sha256Of(file) {
  const buf = await readFile(file);
  return createHash("sha256").update(buf).digest("hex");
}

/** Chequea tamano y hash contra KNOWN_HASHES; devuelve null si no hay entrada para verificar. */
async function verify(variant, name, file) {
  const known = KNOWN_HASHES[variant]?.[name];
  if (!known) return null;
  const stats = await stat(file);
  if (stats.size !== known.size) return false;
  return (await sha256Of(file)) === known.sha256;
}

async function download(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} al bajar ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Primero a un temporal: un build cortado a mitad no deja un archivo trunco
  // con el nombre final, que la proxima corrida tomaria por bueno.
  const tmp = `${dest}.part`;
  await writeFile(tmp, buf);
  await rename(tmp, dest);
  return buf.length;
}

/**
 * Deja `name` bajado y verificado. Si ya estaba pero no coincide con el hash,
 * se baja de nuevo una vez en lugar de solo avisar: si no, un archivo corrupto
 * no se reparaba nunca. Devuelve false si no quedo bien.
 */
async function ensureFile(variant, prefix, outDir, name) {
  const dest = path.join(outDir, name);
  if ((await exists(dest)) && (await verify(variant, name, dest)) !== false) {
    console.log(`  ${name}  (ya estaba)`);
    return { ok: true, bytes: 0 };
  }
  try {
    const bytes = await download(`${BASE_URL}/${prefix}/${name}`, dest);
    if ((await verify(variant, name, dest)) === false) {
      console.warn(`  ! ${name} no coincide con el hash esperado`);
      return { ok: false, bytes };
    }
    console.log(`  ${name}  ${(bytes / 1024 / 1024).toFixed(1)} MB`);
    return { ok: true, bytes };
  } catch (err) {
    console.warn(`  ! no se pudo bajar ${name}: ${err.message}`);
    return { ok: false, bytes: 0 };
  }
}

async function fetchVariant(variant) {
  const prefix = PREFIX[variant];
  if (!prefix) throw new Error(`Variante desconocida: ${variant}`);

  const outDir = path.join(OUT_ROOT, variant);
  await mkdir(outDir, { recursive: true });

  let ok = true;
  let total = 0;
  const manifest = await ensureFile(variant, prefix, outDir, "model.json");
  ok = manifest.ok;
  total += manifest.bytes;

  if (ok) {
    // Los shards se listan en el manifiesto, con rutas relativas a model.json.
    const parsed = JSON.parse(await readFile(path.join(outDir, "model.json"), "utf8"));
    for (const shard of parsed.weightsManifest.flatMap((group) => group.paths)) {
      const result = await ensureFile(variant, prefix, outDir, shard);
      total += result.bytes;
      if (!result.ok) ok = false;
    }
  }

  if (ok) {
    console.log(
      total > 0
        ? `✓ ${variant}: ${(total / 1024 / 1024).toFixed(1)} MB en public/models/coco-ssd/${variant}`
        : `✓ ${variant}: ya estaba completo y verificado`,
    );
    return;
  }

  // La app decide entre modelo local y CDN mirando solo si existe model.json:
  // un modelo a medias se serviria igual y fallaria en el navegador sin caer
  // al respaldo. Se borra entero para que el respaldo funcione de verdad.
  await rm(outDir, { recursive: true, force: true });
  console.warn(
    `! ${variant}: quedo incompleto o con archivos corruptos y se borro; la app va a usar el CDN de Google como respaldo.`,
  );
}

const variants = process.argv.slice(2);
for (const variant of variants.length > 0 ? variants : ["lite_mobilenet_v2"]) {
  console.log(`Descargando ${variant}…`);
  try {
    await fetchVariant(variant);
  } catch (err) {
    // No cortamos el build por esto: sin internet (o con el CDN caido) el
    // detector igual funciona pidiendo el modelo al CDN en el navegador.
    console.warn(`! ${variant}: ${err.message}`);
    console.warn("  seguimos sin el modelo local; la app va a usar el CDN de Google.");
  }
}
