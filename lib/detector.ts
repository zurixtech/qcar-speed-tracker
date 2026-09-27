/**
 * Envoltorio sobre COCO-SSD (TensorFlow.js).
 *
 * Todo corre en el navegador con WebGL: no hace falta backend ni GPU en el
 * servidor, por eso el deploy en Vercel es un sitio estatico y gratis de operar.
 *
 * Este modulo arrastra todo TF.js (~1 MB): importarlo solo con `import()` o
 * `import type`, para que no entre en el bundle inicial de la pagina.
 */
import * as tf from "@tensorflow/tfjs-core";
import { MathBackendWebGL } from "@tensorflow/tfjs-backend-webgl";
import "@tensorflow/tfjs-backend-cpu";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

import type { ModelVariant } from "./settings";
import { isVehicleClass, type Detection } from "./types";

/** Ruta donde `scripts/fetch-model.mjs` deja los pesos servidos por la propia app. */
export function localModelUrl(variant: ModelVariant): string {
  return `/models/coco-ssd/${variant}/model.json`;
}

/** Misma URL que arma coco-ssd por defecto (su `BASE_PATH` + prefijo). */
export function cdnModelUrl(variant: ModelVariant): string {
  const prefix = variant === "lite_mobilenet_v2" ? `ssd${variant}` : `ssd_${variant}`;
  return `https://storage.googleapis.com/tfjs-models/savedmodel/${prefix}/model.json`;
}

/**
 * Devuelve la URL del modelo self-hosteado si existe, o null para usar el CDN
 * por defecto de la libreria. Asi la app funciona igual en redes que
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

/**
 * Olvida el backend actual para que el proximo `ensureBackend` arranque de
 * cero. Hace falta tras perder el contexto WebGL: la instancia vieja queda
 * inservible y TF.js la seguiria usando. Se re-registra la fabrica porque
 * `removeBackend` tambien la borra.
 */
export function resetBackend(): void {
  backendReady = null;
  try {
    tf.removeBackend("webgl");
  } catch {
    // Con el contexto perdido el dispose puede tirar; igual queda removido.
  }
  if (!tf.findBackendFactory("webgl")) {
    tf.registerBackend("webgl", () => new MathBackendWebGL(), 2);
  }
}

export type LoadOptions = {
  /** Progreso de la descarga de pesos, de 0 a 1. */
  onProgress?: (fraction: number) => void;
};

export async function loadDetector(
  variant: ModelVariant,
  { onProgress }: LoadOptions = {},
): Promise<Detector> {
  const backend = await ensureBackend();
  const localUrl = await resolveModelUrl(variant);
  const url = localUrl ?? cdnModelUrl(variant);
  // `cocoSsd.load` no deja pasar `onProgress`, pero su constructor le entrega
  // `modelUrl` tal cual a `loadGraphModel`, que acepta un IOHandler ademas de
  // una URL. Asi se reporta el progreso sin reimplementar el modelo.
  const handler = tf.io.http(url, { onProgress });
  const model = new cocoSsd.ObjectDetection(variant, handler as unknown as string);
  await model.load();

  return {
    backend,
    source: localUrl ? "local" : "cdn",
    dispose: () => {
      try {
        model.dispose();
      } catch {
        // Con el contexto WebGL perdido liberar puede fallar; no importa.
      }
    },
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
