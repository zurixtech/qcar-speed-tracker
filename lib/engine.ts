/**
 * Motor del radar: une tracker + estimacion de velocidad + deteccion de
 * infracciones. Es codigo puro (sin DOM ni TensorFlow), lo que permite
 * testearlo alimentandolo con detecciones sinteticas.
 */
import type { Projector } from "./homography";
import { DEFAULT_SPEED_OPTIONS, estimateSpeed, type SpeedOptions } from "./speed";
import { VehicleTracker, type TrackerOptions } from "./tracker";
import type { Detection, TrackedVehicle, Violation } from "./types";

export type EngineOptions = {
  speed: SpeedOptions;
  tracker: Partial<TrackerOptions>;
  /** Factor del suavizado exponencial (0 = congelado, 1 = sin suavizar). */
  smoothing: number;
  /** Limite de velocidad en m/s. */
  limitMps: number;
  /** Lecturas consecutivas por encima del limite para confirmar la infraccion. */
  confirmReadings: number;
  /** Frames minimos vistos antes de mostrar un vehiculo (filtra falsos positivos). */
  minHits: number;
  /** Calidad minima del ajuste para aceptar una lectura como infraccion. */
  minQuality: number;
};

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  speed: DEFAULT_SPEED_OPTIONS,
  tracker: {},
  smoothing: 0.35,
  limitMps: 60 / 3.6,
  confirmReadings: 3,
  minHits: 3,
  minQuality: 0.6,
};

/** Cuantos puntos de la trayectoria se exponen para dibujar la estela. */
const TRAIL_POINTS = 25;

type TrackState = {
  ema: number | null;
  peak: number | null;
  above: number;
  violated: boolean;
};

export type EngineFrame = {
  vehicles: TrackedVehicle[];
  /** Infracciones detectadas en este frame (una sola vez por vehiculo). */
  newViolations: Violation[];
};

export class RadarEngine {
  private tracker: VehicleTracker;
  private state = new Map<number, TrackState>();
  private options: EngineOptions;

  constructor(options: Partial<EngineOptions> = {}) {
    this.options = { ...DEFAULT_ENGINE_OPTIONS, ...options };
    this.tracker = new VehicleTracker(this.options.tracker);
  }

  setOptions(options: Partial<EngineOptions>): void {
    this.options = { ...this.options, ...options };
    if (options.tracker) this.tracker.setOptions(options.tracker);
  }

  reset(): void {
    this.tracker.reset();
    this.state.clear();
  }

  /**
   * Procesa un frame.
   * @param detections detecciones ya filtradas por clase y confianza
   * @param t timestamp del frame en ms
   * @param projector proyeccion imagen -> calzada, o null si no hay calibracion
   */
  update(detections: readonly Detection[], t: number, projector: Projector | null): EngineFrame {
    const opts = this.options;
    const tracks = this.tracker.update(detections, t);
    const live = new Set<number>();
    const vehicles: TrackedVehicle[] = [];
    const newViolations: Violation[] = [];

    for (const track of tracks) {
      live.add(track.id);
      const last = track.samples.at(-1);
      if (!last) continue;

      const st = this.state.get(track.id) ?? { ema: null, peak: null, above: 0, violated: false };
      const estimate = estimateSpeed(track, projector, opts.speed);

      if (estimate.mps !== null) {
        st.ema = st.ema === null ? estimate.mps : st.ema + opts.smoothing * (estimate.mps - st.ema);
        st.peak = st.peak === null ? st.ema : Math.max(st.peak, st.ema);
      }

      const mps = st.ema;
      const confirmed = track.hits >= opts.minHits;
      const speeding = mps !== null && mps > opts.limitMps;

      if (speeding && confirmed && estimate.quality >= opts.minQuality) st.above++;
      else if (!speeding) st.above = 0;

      if (!st.violated && st.above >= opts.confirmReadings && mps !== null) {
        st.violated = true;
        newViolations.push({
          id: `${track.id}-${Math.round(t)}`,
          trackId: track.id,
          label: track.label,
          mps,
          limitMps: opts.limitMps,
          at: Date.now(),
        });
      }

      this.state.set(track.id, st);

      // Un track que perdimos hace unos frames se sigue mostrando (interpolado
      // por la ultima caja conocida) solo si ya estaba confirmado.
      if (!confirmed && track.missed > 0) continue;

      vehicles.push({
        id: track.id,
        label: track.label,
        score: track.score,
        bbox: last.bbox,
        mps,
        peakMps: st.peak,
        speeding: speeding && confirmed,
        quality: estimate.quality,
        reason: estimate.reason,
        inZone: projector ? projector.inZone(last.ground) : false,
        trail: track.samples.slice(-TRAIL_POINTS).map((s) => s.ground),
      });
    }

    for (const id of this.state.keys()) {
      if (!live.has(id)) this.state.delete(id);
    }

    return { vehicles, newViolations };
  }
}
