/**
 * Envoltorio sobre COCO-SSD (TensorFlow.js).
 *
 * Todo corre en el navegador con WebGL: no hace falta backend ni GPU en el
 * servidor, por eso el deploy en Vercel es un sitio estatico y gratis de operar.
 */
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl";
import "@tensorflow/tfjs-backend-cpu";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

import type { ModelVariant } from "./settings";
import { isVehicleClass, type Detection } from "./types";

/** Ruta donde `scripts/fetch-model.mjs` deja los pesos servidos por la propia app. */
export function localModelUrl(variant: ModelVariant): string {
  return `/models/coco-ssd/${variant}/model.json`;
}

/**
 * Devuelve la URL del modelo self-hosteado si existe, o null para que la
 * libreria use su CDN por defecto. Asi la app funciona igual en redes que
 * bloquean storage.googleapis.com, sin obligar a nadie a bajar 18 MB al repo.
 */
async function resolveModelUrl(variant: ModelVariant): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const url = localModelUrl(variant);
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

export type Detector = {
  /** Corre el modelo sobre el frame actual del video. Devuelve cajas normalizadas. */
  detect(video: HTMLVideoElement, minScore: number): Promise<Detection[]>;
  dispose(): void;
  /** Backend efectivo de TF.js ("webgl" o "cpu"). */
  backend: string;
  /** De donde salieron los pesos, para mostrarlo al diagnosticar. */
  source: "local" | "cdn";
};

const MAX_BOXES = 20;

let backendReady: Promise<string> | null = null;

/** Inicializa el backend de TF.js una sola vez, con caida a CPU si no hay WebGL. */
export async function ensureBackend(): Promise<string> {
  backendReady ??= (async () => {
    try {
      await tf.setBackend("webgl");
      await tf.ready();
      if (tf.getBackend() === "webgl") return "webgl";
    } catch {
      // Sin WebGL (o context perdido): seguimos en CPU, mas lento pero funciona.
    }
    await tf.setBackend("cpu");
    await tf.ready();
    return tf.getBackend();
  })();
  return backendReady;
}

export async function loadDetector(variant: ModelVariant): Promise<Detector> {
  const backend = await ensureBackend();
  const modelUrl = await resolveModelUrl(variant);
  const model = await cocoSsd.load(
    modelUrl ? { base: variant, modelUrl } : { base: variant },
  );

  return {
    backend,
    source: modelUrl ? "local" : "cdn",
    dispose: () => model.dispose(),
    async detect(video, minScore) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return [];

      const raw = await model.detect(video, MAX_BOXES, minScore);
      const out: Detection[] = [];
      for (const p of raw) {
        if (!isVehicleClass(p.class)) continue;
        const [x, y, w, h] = p.bbox;
        if (!(w > 0) || !(h > 0)) continue;
        out.push({
          label: p.class,
          score: p.score,
          bbox: { x: x / vw, y: y / vh, w: w / vw, h: h / vh },
        });
      }
      return out;
    },
  };
}
