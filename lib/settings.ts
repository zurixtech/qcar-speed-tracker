/** Configuracion del radar: valores por defecto, validacion y persistencia. */
import type { Calibration, Quad } from "./homography";
import { fromKmh, fromMph } from "./speed";
import type { Units } from "./types";

export type ModelVariant = "lite_mobilenet_v2" | "mobilenet_v2";

/** El radar mide de a un auto o de a dos: mas cajas en una pantalla de celular no se leen. */
export type MaxVehicles = 1 | 2;

export type Settings = {
  units: Units;
  /** Limite expresado en las unidades elegidas (km/h o mph). */
  speedLimit: number;
  /** Confianza minima del detector, 0..1. */
  minScore: number;
  /** Cuantos vehiculos se siguen a la vez: uno o dos, nada mas. */
  maxVehicles: MaxVehicles;
  modelVariant: ModelVariant;
  calibration: Calibration;
  /** Medir solo dentro de la zona calibrada (recomendado). */
  requireInZone: boolean;
  /** Suavizado exponencial de la velocidad, 0..1. */
  smoothing: number;
  showZone: boolean;
  showTrails: boolean;
  soundAlerts: boolean;
  /** Lecturas consecutivas sobre el limite para confirmar la infraccion. */
  confirmReadings: number;
};

/**
 * Zona por defecto: un trapecio sobre la mitad inferior del cuadro, que es
 * como se ve la calzada cuando apoyas el telefono en la banquina.
 */
export const DEFAULT_QUAD: Quad = [
  { x: 0.3, y: 0.45 },
  { x: 0.7, y: 0.45 },
  { x: 0.95, y: 0.92 },
  { x: 0.05, y: 0.92 },
];

export const DEFAULT_SETTINGS: Settings = {
  units: "kmh",
  speedLimit: 60,
  minScore: 0.5,
  maxVehicles: 2,
  modelVariant: "lite_mobilenet_v2",
  calibration: {
    quad: DEFAULT_QUAD,
    widthMeters: 7,
    lengthMeters: 25,
  },
  requireInZone: true,
  smoothing: 0.35,
  showZone: true,
  showTrails: true,
  soundAlerts: true,
  confirmReadings: 3,
};

export const STORAGE_KEY = "qcar-speed-tracker:settings:v1";

/** Convierte el limite configurado a m/s. */
export function limitToMps(settings: Pick<Settings, "speedLimit" | "units">): number {
  return settings.units === "kmh" ? fromKmh(settings.speedLimit) : fromMph(settings.speedLimit);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function sanitizeQuad(value: unknown): Quad {
  if (!Array.isArray(value) || value.length !== 4) return DEFAULT_QUAD;
  const pts = value.map((p, i) => {
    const src = (p ?? {}) as { x?: unknown; y?: unknown };
    return {
      x: clamp(num(src.x, DEFAULT_QUAD[i].x), 0, 1),
      y: clamp(num(src.y, DEFAULT_QUAD[i].y), 0, 1),
    };
  });
  return [pts[0], pts[1], pts[2], pts[3]];
}

/** Normaliza cualquier objeto (p. ej. de localStorage) a un `Settings` valido. */
export function sanitizeSettings(value: unknown): Settings {
  const raw = (value ?? {}) as Partial<Settings> & { calibration?: Partial<Calibration> };
  const cal: Partial<Calibration> = raw.calibration ?? {};
  return {
    units: raw.units === "mph" ? "mph" : "kmh",
    speedLimit: clamp(num(raw.speedLimit, DEFAULT_SETTINGS.speedLimit), 1, 400),
    minScore: clamp(num(raw.minScore, DEFAULT_SETTINGS.minScore), 0.05, 0.95),
    maxVehicles: raw.maxVehicles === 1 ? 1 : 2,
    modelVariant: raw.modelVariant === "mobilenet_v2" ? "mobilenet_v2" : "lite_mobilenet_v2",
    calibration: {
      quad: sanitizeQuad(cal.quad),
      widthMeters: clamp(num(cal.widthMeters, DEFAULT_SETTINGS.calibration.widthMeters), 0.5, 200),
      lengthMeters: clamp(num(cal.lengthMeters, DEFAULT_SETTINGS.calibration.lengthMeters), 0.5, 500),
    },
    requireInZone: raw.requireInZone ?? DEFAULT_SETTINGS.requireInZone,
    smoothing: clamp(num(raw.smoothing, DEFAULT_SETTINGS.smoothing), 0.05, 1),
    showZone: raw.showZone ?? DEFAULT_SETTINGS.showZone,
    showTrails: raw.showTrails ?? DEFAULT_SETTINGS.showTrails,
    soundAlerts: raw.soundAlerts ?? DEFAULT_SETTINGS.soundAlerts,
    confirmReadings: Math.round(
      clamp(num(raw.confirmReadings, DEFAULT_SETTINGS.confirmReadings), 1, 15),
    ),
  };
}

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Modo privado o storage lleno: la app sigue funcionando sin persistencia.
  }
}
