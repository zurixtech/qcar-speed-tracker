/**
 * Estimacion de velocidad a partir de la trayectoria de un track.
 *
 * En lugar de derivar la posicion entre dos frames consecutivos (muy ruidoso:
 * la caja del detector "tiembla" varios pixeles por frame), ajustamos una
 * recta a las posiciones del mundo real en una ventana temporal corta y
 * tomamos su pendiente como vector velocidad. El error del detector se
 * promedia y el resultado es mucho mas estable.
 */
import type { Projector } from "./homography";
import type { Point, SpeedEstimate, Track } from "./types";

export type SpeedOptions = {
  /** Ventana temporal usada para el ajuste, en ms. */
  windowMs: number;
  /** Muestras minimas dentro de la ventana. */
  minSamples: number;
  /** Duracion minima cubierta por la ventana, en ms. */
  minSpanMs: number;
  /** Si es true, solo se usan muestras dentro de la zona calibrada. */
  requireInZone: boolean;
  /** Velocidad por encima de la cual se descarta la lectura (m/s). */
  maxMps: number;
};

export const DEFAULT_SPEED_OPTIONS: SpeedOptions = {
  windowMs: 900,
  minSamples: 4,
  minSpanMs: 250,
  requireInZone: true,
  maxMps: 83, // ~300 km/h: por encima casi siempre es un cruce de identidades.
};

const EPS = 1e-9;

export const MPS_TO_KMH = 3.6;
export const MPS_TO_MPH = 2.2369362920544;

export function toKmh(mps: number): number {
  return mps * MPS_TO_KMH;
}

export function toMph(mps: number): number {
  return mps * MPS_TO_MPH;
}

export function fromKmh(kmh: number): number {
  return kmh / MPS_TO_KMH;
}

export function fromMph(mph: number): number {
  return mph / MPS_TO_MPH;
}

/**
 * Estima la velocidad instantanea del track en m/s.
 * `projector` puede ser null: en ese caso no hay escala metrica y no se puede
 * medir nada (devolvemos el motivo para mostrarlo en la UI).
 */
export function estimateSpeed(
  track: Track,
  projector: Projector | null,
  options: SpeedOptions = DEFAULT_SPEED_OPTIONS,
): SpeedEstimate {
  if (!projector) return { mps: null, reason: "no-calibration", quality: 0 };

  const last = track.samples.at(-1);
  if (!last) return { mps: null, reason: "insufficient-samples", quality: 0 };

  const cutoff = last.t - options.windowMs;
  const times: number[] = [];
  const pts: Point[] = [];
  let droppedOutside = 0;

  for (const s of track.samples) {
    if (s.t < cutoff) continue;
    if (options.requireInZone && !projector.inZone(s.ground)) {
      droppedOutside++;
      continue;
    }
    const world = projector.toWorld(s.ground);
    if (!world) continue;
    times.push(s.t / 1000);
    pts.push(world);
  }

  if (pts.length < options.minSamples) {
    const reason = droppedOutside > 0 && pts.length === 0 ? "outside-zone" : "insufficient-samples";
    return { mps: null, reason, quality: 0 };
  }

  const span = times[times.length - 1] - times[0];
  if (span * 1000 < options.minSpanMs) {
    return { mps: null, reason: "insufficient-time", quality: 0 };
  }

  const fit = fitVelocity(times, pts);
  if (!fit) return { mps: null, reason: "insufficient-time", quality: 0 };

  const mps = Math.hypot(fit.vx, fit.vy);
  if (!Number.isFinite(mps) || mps > options.maxMps) {
    return { mps: null, reason: "implausible", quality: 0 };
  }

  // La confianza combina el ajuste de la recta con cuantas muestras la sostienen.
  const sampleConfidence = Math.min(1, pts.length / (options.minSamples * 2));
  const quality = clamp01(fit.r2) * (0.5 + 0.5 * sampleConfidence);

  return { mps, quality };
}

/** Regresion lineal de x(t) e y(t); la pendiente es el vector velocidad. */
export function fitVelocity(
  times: readonly number[],
  pts: readonly Point[],
): { vx: number; vy: number; r2: number } | null {
  const n = times.length;
  if (n < 2 || pts.length !== n) return null;

  const tMean = mean(times);
  const xMean = mean(pts.map((p) => p.x));
  const yMean = mean(pts.map((p) => p.y));

  let stt = 0;
  let stx = 0;
  let sty = 0;
  for (let i = 0; i < n; i++) {
    const dt = times[i] - tMean;
    stt += dt * dt;
    stx += dt * (pts[i].x - xMean);
    sty += dt * (pts[i].y - yMean);
  }
  if (stt < EPS) return null;

  const vx = stx / stt;
  const vy = sty / stt;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const dt = times[i] - tMean;
    const dx = pts[i].x - (xMean + vx * dt);
    const dy = pts[i].y - (yMean + vy * dt);
    ssRes += dx * dx + dy * dy;
    ssTot += (pts[i].x - xMean) ** 2 + (pts[i].y - yMean) ** 2;
  }
  // Si el vehiculo esta quieto no hay varianza que explicar: el ajuste es exacto.
  const r2 = ssTot < EPS ? 1 : 1 - ssRes / ssTot;

  return { vx, vy, r2 };
}

function mean(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
