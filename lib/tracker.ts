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
  /** Frames consecutivos sin match antes de descartar el track. */
  maxMissed: number;
  /** Ventana de historial que se conserva por track, en ms. */
  historyMs: number;
};

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  iouThreshold: 0.2,
  maxMissed: 10,
  historyMs: 2500,
};

export function bboxCenter(b: BBox): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Punto de contacto con la calzada: centro del borde inferior de la caja. */
export function groundPoint(b: BBox): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h };
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
    const { iouThreshold, maxMissed, historyMs } = this.options;

    // 1. Todos los pares (track, deteccion) con IoU suficiente, de mayor a menor.
    const pairs: { ti: number; di: number; score: number }[] = [];
    for (let ti = 0; ti < this.tracks.length; ti++) {
      const last = this.tracks[ti].samples.at(-1);
      if (!last) continue;
      for (let di = 0; di < detections.length; di++) {
        const score = iou(last.bbox, detections[di].bbox);
        if (score >= iouThreshold) pairs.push({ ti, di, score });
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
    this.tracks = this.tracks.filter((tr) => tr.missed <= maxMissed);
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
