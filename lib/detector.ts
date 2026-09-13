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

export type Detector = {
  /** Corre el modelo sobre el frame actual del video. Devuelve cajas normalizadas. */
  detect(video: HTMLVideoElement, minScore: number): Promise<Detection[]>;
  dispose(): void;
  /** Backend efectivo de TF.js ("webgl" o "cpu"). */
  backend: string;
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
  const model = await cocoSsd.load({ base: variant });

  return {
    backend,
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
