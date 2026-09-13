/**
 * Estimacion de velocidad a partir de la trayectoria de un track.
 *
 * En lugar de derivar la posicion entre dos frames consecutivos (muy ruidoso:
 * la caja del detector "tiembla" varios pixeles por frame), ajustamos una
 * recta a las posiciones del mundo real en una ventana temporal corta y
 * tomamos su pendiente como vector velocidad. El error del detector se
 * promedia y el resultado es mucho mas estable.
 */
import { DEFAULT_FOV_DEG, focalFromFov, monocularPoint } from "./autoscale";
import type { Projector } from "./homography";
import type { Point, SpeedEstimate, Track, TrackSample } from "./types";

export type SpeedOptions = {
  /** Ventana temporal preferida para el ajuste, en ms. */
  windowMs: number;
  /**
   * Tope al que se puede estirar la ventana cuando faltan muestras.
   *
   * A 25 fps la ventana normal trae 20 y pico de puntos, pero en una maquina
   * sin aceleracion por GPU el detector baja a 2-3 fps y esa misma ventana
   * queda por debajo de `minSamples`: sin esto, en equipos lentos no se
   * mediria nunca nada. Estirando la ventana la lectura aparece igual, con
   * algo mas de retardo.
   */
  maxWindowMs: number;
  /** Muestras minimas dentro de la ventana. */
  minSamples: number;
  /** Duracion minima cubierta por la ventana, en ms. */
  minSpanMs: number;
  /** Si es true, solo se usan muestras dentro de la zona calibrada. */
  requireInZone: boolean;
  /** Velocidad por encima de la cual se descarta la lectura (m/s). */
  maxMps: number;
  /**
   * Respaldo sin calibrar: si la zona no da una lectura, medir igual usando el
   * tamano aparente del propio vehiculo como escala (ver `autoscale.ts`).
   */
  autoScale: boolean;
  /** Campo de vision horizontal de la camara en grados, para `autoScale`. */
  fovDeg: number;
};

export const DEFAULT_SPEED_OPTIONS: SpeedOptions = {
  windowMs: 900,
  maxWindowMs: 2400,
  minSamples: 4,
  minSpanMs: 250,
  requireInZone: true,
  maxMps: 83, // ~300 km/h: por encima casi siempre es un cruce de identidades.
  autoScale: true,
  fovDeg: DEFAULT_FOV_DEG,
};

const EPS = 1e-9;

/**
 * Cuanta calidad pierde una lectura por escala automatica. La trayectoria puede
 * ajustar perfecto y aun asi el numero depende de un ancho supuesto: sin este
 * descuento una estimacion aproximada labraria infracciones igual que una
 * medida sobre la zona calibrada.
 */
const AUTO_QUALITY_PENALTY = 0.75;

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
 *
 * Se intenta primero la zona calibrada, que es la medicion buena. Si no da
 * (todavia no se calibro, o el vehiculo pasa por afuera del trapecio) y
 * `autoScale` esta activo, se cae al respaldo por tamano del vehiculo: peor
 * precision, pero un numero desde el primer segundo. `source` dice cual salio.
 */
export function estimateSpeed(
  track: Track,
  projector: Projector | null,
  options: SpeedOptions = DEFAULT_SPEED_OPTIONS,
): SpeedEstimate {
  if (!track.samples.at(-1)) return { mps: null, reason: "insufficient-samples", quality: 0 };

  const calibrated: SpeedEstimate = projector
    ? measureInZone(track, projector, options)
    : { mps: null, reason: "no-calibration", quality: 0 };

  if (calibrated.mps !== null || !options.autoScale) return calibrated;

  // Con la escala automatica encendida, el motivo que importa es el suyo: el
  // "fuera de zona" o el "sin calibrar" ya dejaron de ser lo que frena la
  // lectura.
  return measureByVehicleSize(track, options) ?? calibrated;
}

/** Camino preciso: homografia sobre el punto de contacto con la calzada. */
function measureInZone(track: Track, projector: Projector, options: SpeedOptions): SpeedEstimate {
  let outside = 0;
  const fit = fitWindow(track, options, (s) => {
    if (options.requireInZone && !projector.inZone(s.ground)) {
      outside++;
      return null;
    }
    return projector.toWorld(s.ground);
  });

  if (fit.ok) return { mps: fit.mps, quality: fit.quality, source: "zone" };
  const reason = fit.reason === "no-points" && outside > 0 ? "outside-zone" : failReason(fit.reason);
  return { mps: null, reason, quality: 0 };
}

/**
 * Camino aproximado: la escala sale del ancho supuesto del vehiculo, sin
 * calibracion ni zona. Devuelve null si el campo de vision configurado no da
 * una distancia focal utilizable (en ese caso vale mas el motivo del otro
 * camino que inventar uno nuevo).
 */
function measureByVehicleSize(track: Track, options: SpeedOptions): SpeedEstimate | null {
  const focal = focalFromFov(options.fovDeg);
  if (focal === null) return null;

  let tooSmall = 0;
  const fit = fitWindow(track, options, (s) => {
    const point = monocularPoint(s.bbox, track.label, focal);
    if (!point) tooSmall++;
    return point;
  });

  if (fit.ok) {
    return { mps: fit.mps, quality: fit.quality * AUTO_QUALITY_PENALTY, source: "auto" };
  }
  const reason = fit.reason === "no-points" && tooSmall > 0 ? "too-small" : failReason(fit.reason);
  return { mps: null, reason, quality: 0 };
}

type WindowFit =
  | { ok: true; mps: number; quality: number }
  | { ok: false; reason: "no-points" | "insufficient-samples" | "insufficient-time" | "implausible" };

/**
 * Ajusta la recta sobre la ventana temporal del track. `toPoint` es lo unico
 * que cambia entre los dos caminos: convierte una muestra en una posicion en
 * metros, o devuelve null si esa muestra no sirve.
 */
function fitWindow(
  track: Track,
  options: SpeedOptions,
  toPoint: (sample: TrackSample) => Point | null,
): WindowFit {
  const last = track.samples.at(-1);
  if (!last) return { ok: false, reason: "no-points" };

  // Juntamos todo lo utilizable dentro del tope y, si la ventana preferida ya
  // alcanza, nos quedamos solo con esa (lectura mas fresca).
  const maxCutoff = last.t - Math.max(options.windowMs, options.maxWindowMs);
  const usableTimes: number[] = [];
  const usablePts: Point[] = [];

  for (const s of track.samples) {
    if (s.t < maxCutoff) continue;
    const point = toPoint(s);
    if (!point) continue;
    usableTimes.push(s.t / 1000);
    usablePts.push(point);
  }

  const preferredFrom = usableTimes.findIndex((t) => t * 1000 >= last.t - options.windowMs);
  const enoughInPreferred =
    preferredFrom >= 0 && usableTimes.length - preferredFrom >= options.minSamples;
  const from = enoughInPreferred ? preferredFrom : 0;

  const times = usableTimes.slice(from);
  const pts = usablePts.slice(from);

  if (pts.length < options.minSamples) {
    return { ok: false, reason: pts.length === 0 ? "no-points" : "insufficient-samples" };
  }

  const span = times[times.length - 1] - times[0];
  if (span * 1000 < options.minSpanMs) return { ok: false, reason: "insufficient-time" };

  const fit = fitVelocity(times, pts);
  if (!fit) return { ok: false, reason: "insufficient-time" };

  const mps = Math.hypot(fit.vx, fit.vy);
  if (!Number.isFinite(mps) || mps > options.maxMps) {
    return { ok: false, reason: "implausible" };
  }

  // La confianza combina el ajuste de la recta con cuantas muestras la sostienen.
  const sampleConfidence = Math.min(1, pts.length / (options.minSamples * 2));
  return { ok: true, mps, quality: clamp01(fit.r2) * (0.5 + 0.5 * sampleConfidence) };
}

/** "no-points" sin un motivo mas especifico es, para la UI, falta de muestras. */
function failReason(reason: Extract<WindowFit, { ok: false }>["reason"]): SpeedEstimate["reason"] {
  return reason === "no-points" ? "insufficient-samples" : reason;
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
