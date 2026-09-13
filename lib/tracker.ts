/**
 * Tracker multi-objeto minimalista por IoU.
 *
 * COCO-SSD detecta cada frame de forma independiente; para medir velocidad
 * necesitamos saber que un auto del frame N es el mismo del frame N+1. Este
 * tracker asocia detecciones a tracks existentes por solapamiento de cajas
 * (matching voraz por IoU descendente), que es suficiente para trafico visto
 * desde la banquina y mucho mas barato que un Kalman + Hungarian.
 */
import type { BBox, Detection, Point, Track, TrackSample } from "./types";

export type TrackerOptions = {
  /** IoU minimo para considerar que una deteccion continua un track. */
  iouThreshold: number;
  /**
   * Tiempo sin match antes de descartar el track, en ms.
   *
   * Va en milisegundos y no en frames a proposito: la velocidad de inferencia
   * cambia muchisimo entre un celular con GPU (20-30 fps) y una maquina sin
   * aceleracion (2-3 fps). Contando frames, un umbral razonable en el primer
   * caso deja cajas fantasma varios segundos sobre asfalto vacio en el segundo.
   */
  maxMissedMs: number;
  /**
   * Cuando el IoU no alcanza, se acepta el match si el centro de la deteccion
   * cae a menos de esta cantidad de diagonales de la caja predicha.
   *
   * Es lo que permite arrancar un track a pocos fps: en el primer par de frames
   * todavia no hay velocidad estimada, y un auto rapido puede haberse corrido
   * varias veces el ancho de su propia caja. Se limita ademas por similitud de
   * tamano, para no engancharse con un vehiculo distinto que pase cerca.
   */
  proximityDiagonals: number;
  /** Ventana de historial que se conserva por track, en ms. */
  historyMs: number;
};

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  iouThreshold: 0.2,
  maxMissedMs: 400,
  proximityDiagonals: 2,
  historyMs: 3000,
};

export function bboxCenter(b: BBox): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Punto de contacto con la calzada: centro del borde inferior de la caja. */
export function groundPoint(b: BBox): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h };
}

/**
 * Predice donde estara la caja de un track en el instante `t`, extrapolando la
 * velocidad en pixeles de sus ultimas dos muestras.
 *
 * Sin esto, el matching compara contra la ultima posicion conocida y a pocos
 * fps un auto rapido simplemente no solapa consigo mismo: el track se parte en
 * uno nuevo cada frame y nunca se junta historial suficiente para medir. Con la
 * prediccion, el mismo auto se sigue reconociendo aunque se haya desplazado
 * varias veces el ancho de su caja.
 */
export function predictBBox(track: Track, t: number, maxLookaheadMs = 600): BBox | null {
  const last = track.samples.at(-1);
  if (!last) return null;

  const prev = track.samples.at(-2);
  const dt = t - last.t;
  if (!prev || dt <= 0) return last.bbox;

  const step = last.t - prev.t;
  if (step <= 0) return last.bbox;

  // Extrapolar demasiado lejos genera predicciones sin sentido.
  const lookahead = Math.min(dt, maxLookaheadMs);
  const vx = (last.bbox.x - prev.bbox.x) / step;
  const vy = (last.bbox.y - prev.bbox.y) / step;

  return {
    x: last.bbox.x + vx * lookahead,
    y: last.bbox.y + vy * lookahead,
    w: last.bbox.w,
    h: last.bbox.h,
  };
}

/**
 * Puntaje de respaldo por cercania, siempre por debajo de cualquier match por
 * IoU para que el solapamiento real tenga prioridad. Devuelve 0 si las cajas
 * estan lejos o tienen tamanos muy distintos.
 */
export function proximityScore(predicted: BBox, candidate: BBox, maxDiagonals: number): number {
  const areaA = predicted.w * predicted.h;
  const areaB = candidate.w * candidate.h;
  if (areaA <= 0 || areaB <= 0) return 0;

  // Un vehiculo no triplica ni divide por tres su tamano de un frame al otro.
  const ratio = areaA > areaB ? areaA / areaB : areaB / areaA;
  if (ratio > 3) return 0;

  const diagonal = Math.hypot(predicted.w, predicted.h);
  if (diagonal <= 0) return 0;

  const a = bboxCenter(predicted);
  const b = bboxCenter(candidate);
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const limit = diagonal * maxDiagonals;
  if (distance >= limit) return 0;

  // Escalado a [0, 0.15): por debajo del umbral de IoU, nunca le gana.
  return (1 - distance / limit) * 0.15;
}

export function iou(a: BBox, b: BBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = x2 - x1;
  const ih = y2 - y1;
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

export class VehicleTracker {
  private tracks: Track[] = [];
  private nextId = 1;
  private options: TrackerOptions;

  constructor(options: Partial<TrackerOptions> = {}) {
    this.options = { ...DEFAULT_TRACKER_OPTIONS, ...options };
  }

  setOptions(options: Partial<TrackerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
  }

  getTracks(): readonly Track[] {
    return this.tracks;
  }

  /**
   * Procesa las detecciones de un frame y devuelve los tracks vivos.
   * `t` es el timestamp del frame en ms (ver `lib/clock.ts`).
   */
  update(detections: readonly Detection[], t: number): readonly Track[] {
    const { iouThreshold, maxMissedMs, proximityDiagonals, historyMs } = this.options;

    // 1. Todos los pares (track, deteccion) con IoU suficiente, de mayor a menor.
    const pairs: { ti: number; di: number; score: number }[] = [];
    for (let ti = 0; ti < this.tracks.length; ti++) {
      const predicted = predictBBox(this.tracks[ti], t);
      if (!predicted) continue;
      for (let di = 0; di < detections.length; di++) {
        const overlap = iou(predicted, detections[di].bbox);
        const score =
          overlap >= iouThreshold
            ? overlap
            : proximityScore(predicted, detections[di].bbox, proximityDiagonals);
        if (score > 0) pairs.push({ ti, di, score });
      }
    }
    pairs.sort((a, b) => b.score - a.score);

    // 2. Asignacion voraz: cada track y cada deteccion se usan una sola vez.
    const takenTracks = new Set<number>();
    const takenDets = new Set<number>();
    for (const pair of pairs) {
      if (takenTracks.has(pair.ti) || takenDets.has(pair.di)) continue;
      takenTracks.add(pair.ti);
      takenDets.add(pair.di);
      this.appendSample(this.tracks[pair.ti], detections[pair.di], t);
    }

    // 3. Tracks sin match: envejecen.
    for (let ti = 0; ti < this.tracks.length; ti++) {
      if (!takenTracks.has(ti)) this.tracks[ti].missed++;
    }

    // 4. Detecciones sin match: tracks nuevos.
    for (let di = 0; di < detections.length; di++) {
      if (takenDets.has(di)) continue;
      const det = detections[di];
      this.tracks.push({
        id: this.nextId++,
        label: det.label,
        score: det.score,
        samples: [makeSample(det.bbox, t)],
        missed: 0,
        hits: 1,
        firstSeen: t,
        lastSeen: t,
      });
    }

    // 5. Poda de tracks muertos y de historial viejo.
    this.tracks = this.tracks.filter((tr) => t - tr.lastSeen <= maxMissedMs);
    for (const tr of this.tracks) {
      const cutoff = t - historyMs;
      if (tr.samples.length > 2 && tr.samples[0].t < cutoff) {
        const keepFrom = tr.samples.findIndex((s) => s.t >= cutoff);
        // Siempre dejamos al menos dos muestras para poder estimar velocidad.
        const idx = keepFrom < 0 ? tr.samples.length - 2 : Math.min(keepFrom, tr.samples.length - 2);
        if (idx > 0) tr.samples = tr.samples.slice(idx);
      }
    }

    return this.tracks;
  }

  private appendSample(track: Track, det: Detection, t: number): void {
    track.samples.push(makeSample(det.bbox, t));
    track.missed = 0;
    track.hits++;
    track.lastSeen = t;
    track.label = det.label;
    // Media movil de la confianza, para que un frame flojo no cambie la etiqueta.
    track.score = track.score * 0.7 + det.score * 0.3;
  }
}

function makeSample(bbox: BBox, t: number): TrackSample {
  return { t, bbox, ground: groundPoint(bbox) };
}
