/**
 * Motor del radar: une tracker + estimacion de velocidad + deteccion de
 * infracciones. Es codigo puro (sin DOM ni TensorFlow), lo que permite
 * testearlo alimentandolo con detecciones sinteticas.
 */
import type { Projector } from "./homography";
import { DEFAULT_SPEED_OPTIONS, estimateSpeed, type SpeedOptions } from "./speed";
import { VehicleTracker, type TrackerOptions } from "./tracker";
import type {
  Detection,
  SpeedEstimate,
  SpeedSource,
  Track,
  TrackedVehicle,
  Violation,
} from "./types";

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
  /** Cuantos vehiculos se miden a la vez (1 o 2). El resto se ignora. */
  maxVehicles: number;
};

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  speed: DEFAULT_SPEED_OPTIONS,
  tracker: {},
  smoothing: 0.35,
  limitMps: 60 / 3.6,
  confirmReadings: 3,
  minHits: 3,
  minQuality: 0.6,
  maxVehicles: 2,
};

/** Cuantos puntos de la trayectoria se exponen para dibujar la estela. */
const TRAIL_POINTS = 25;

/**
 * Cuanto pesa seguir mirando al auto que ya veniamos midiendo. Sin esta
 * histeresis, dos autos de tamano parecido se roban el turno frame a frame y
 * el recuadro salta de uno al otro.
 */
const STICKY_BONUS = 1.5;

/** Un auto dentro de la zona calibrada es el que interesa: es el unico medible. */
const IN_ZONE_BONUS = 1.6;

type TrackState = {
  ema: number | null;
  peak: number | null;
  above: number;
  violated: boolean;
  /** Con que escala se obtuvo la ultima lectura que alimento al EMA. */
  source?: SpeedSource;
};

export type EngineFrame = {
  /** Los vehiculos elegidos (a lo sumo `maxVehicles`), listos para dibujar. */
  vehicles: TrackedVehicle[];
  /** Cuantos vehiculos hay en el cuadro, incluidos los que no se siguen. */
  detected: number;
  /** Infracciones detectadas en este frame (una sola vez por vehiculo). */
  newViolations: Violation[];
};

export class RadarEngine {
  private tracker: VehicleTracker;
  private state = new Map<number, TrackState>();
  /** Ids elegidos en el frame anterior: dan la histeresis de `priority`. */
  private selected = new Set<number>();
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
    this.selected.clear();
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
    for (const track of tracks) live.add(track.id);

    const visible = tracks.filter((track) => {
      if (!track.samples.at(-1)) return false;
      // Un track que perdimos hace unos frames se sigue mostrando (por su
      // ultima caja conocida) solo si ya estaba confirmado.
      return track.hits >= opts.minHits || track.missed === 0;
    });

    const chosen = this.select(visible, projector);
    this.selected = new Set(chosen.map((track) => track.id));

    const vehicles: TrackedVehicle[] = [];
    const newViolations: Violation[] = [];

    for (const track of chosen) {
      const last = track.samples.at(-1)!;
      const st = this.state.get(track.id) ?? { ema: null, peak: null, above: 0, violated: false };
      const raw = estimateSpeed(track, projector, opts.speed);
      // Si la zona calibrada ya midio a este vehiculo, la escala aproximada no
      // vuelve a pisarla: al salir del trapecio la lectura se congela en el
      // ultimo valor bueno, en vez de saltar a una estimacion peor justo cuando
      // el auto se va de cuadro.
      const estimate: SpeedEstimate =
        st.source === "zone" && raw.source === "auto" ? { mps: null, quality: 0 } : raw;

      if (estimate.mps !== null) {
        st.ema = st.ema === null ? estimate.mps : st.ema + opts.smoothing * (estimate.mps - st.ema);
        st.peak = st.peak === null ? st.ema : Math.max(st.peak, st.ema);
        st.source = estimate.source;
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
        source: st.source,
        inZone: projector ? projector.inZone(last.ground) : false,
        trail: track.samples.slice(-TRAIL_POINTS).map((s) => s.ground),
      });
    }

    // El estado se guarda mientras el track viva, aunque en este frame no haya
    // sido elegido: si vuelve a entrar en foco no arranca de cero ni vuelve a
    // labrar la misma infraccion.
    for (const id of this.state.keys()) {
      if (!live.has(id)) this.state.delete(id);
    }

    return { vehicles, detected: visible.length, newViolations };
  }

  /**
   * Se queda con los `maxVehicles` vehiculos que importan. El criterio es el
   * tamano de la caja (el auto mas grande es el mas cercano a la camara, el
   * unico que se mide bien), con premio para el que esta dentro de la zona
   * calibrada y para el que ya veniamos siguiendo.
   */
  private select(tracks: readonly Track[], projector: Projector | null): Track[] {
    const limit = Math.max(1, Math.round(this.options.maxVehicles));
    if (tracks.length <= limit) return [...tracks];

    return [...tracks]
      .map((track) => ({ track, priority: this.priority(track, projector) }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit)
      .map((entry) => entry.track);
  }

  private priority(track: Track, projector: Projector | null): number {
    const last = track.samples.at(-1);
    if (!last) return 0;
    let score = last.bbox.w * last.bbox.h;
    if (projector?.inZone(last.ground)) score *= IN_ZONE_BONUS;
    if (this.selected.has(track.id)) score *= STICKY_BONUS;
    return score;
  }
}
