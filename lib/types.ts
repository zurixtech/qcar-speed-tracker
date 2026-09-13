/** Tipos compartidos del pipeline de deteccion -> tracking -> velocidad. */

export type Point = { x: number; y: number };

/**
 * Rectangulo en coordenadas de imagen NORMALIZADAS (0..1 respecto del frame).
 * Todo el pipeline trabaja en normalizado para ser independiente de la
 * resolucion de la fuente y del tamano del canvas de dibujo.
 */
export type BBox = { x: number; y: number; w: number; h: number };

/** Clases de vehiculo que reconoce COCO-SSD y que nos interesan. */
export const VEHICLE_CLASSES = ["car", "truck", "bus", "motorcycle", "bicycle"] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export function isVehicleClass(name: string): name is VehicleClass {
  return (VEHICLE_CLASSES as readonly string[]).includes(name);
}

/** Una deteccion cruda de un frame. */
export type Detection = {
  bbox: BBox;
  /** Etiqueta del modelo, p. ej. "car". */
  label: string;
  /** Confianza 0..1. */
  score: number;
};

/**
 * Muestra de la trayectoria de un vehiculo. Guarda solo coordenadas de imagen:
 * la proyeccion al mundo se recalcula al vuelo, para que un cambio de
 * calibracion se refleje de inmediato en las velocidades mostradas.
 */
export type TrackSample = {
  /** Timestamp en milisegundos (monotono dentro de una sesion). */
  t: number;
  bbox: BBox;
  /** Punto de contacto con el suelo (centro inferior del bbox), normalizado. */
  ground: Point;
};

export type Track = {
  id: number;
  label: string;
  score: number;
  /** Historial ordenado por tiempo ascendente (se poda a una ventana). */
  samples: TrackSample[];
  /** Frames consecutivos sin match. */
  missed: number;
  /** Cantidad total de frames en que se vio el track. */
  hits: number;
  firstSeen: number;
  lastSeen: number;
};

/** Estimacion de velocidad para un track en un instante dado. */
export type SpeedEstimate = {
  /** Velocidad en metros por segundo. null si aun no hay datos suficientes. */
  mps: number | null;
  /** Motivo por el que no hay estimacion (para mostrar en la UI). */
  reason?:
    | "insufficient-samples"
    | "insufficient-time"
    | "no-calibration"
    | "outside-zone"
    | "implausible";
  /** Confianza heuristica 0..1 del ajuste lineal. */
  quality: number;
};

export type Units = "kmh" | "mph";

/** Estado publico de un vehiculo, listo para dibujar. */
export type TrackedVehicle = {
  id: number;
  label: string;
  score: number;
  bbox: BBox;
  /** Velocidad suavizada en m/s, o null si todavia no se puede estimar. */
  mps: number | null;
  /** Pico de velocidad observado en m/s. */
  peakMps: number | null;
  speeding: boolean;
  quality: number;
  reason?: SpeedEstimate["reason"];
  inZone: boolean;
  /** Ultimos puntos de contacto con el suelo (normalizados), para dibujar la estela. */
  trail: Point[];
};

export type Violation = {
  id: string;
  trackId: number;
  label: string;
  /** Velocidad en m/s en el momento de la infraccion. */
  mps: number;
  /** Limite configurado en m/s al momento de la infraccion. */
  limitMps: number;
  /** Fecha en ms epoch (Date.now()). */
  at: number;
  /** Captura del frame en el momento de la infraccion (data URL), si se pudo tomar. */
  snapshot?: string;
};
