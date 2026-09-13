/**
 * Camara sintetica para los tests: proyecta un vehiculo que se mueve por la
 * calzada a una velocidad conocida y genera las detecciones que produciria el
 * detector. Sirve para comprobar de punta a punta que la velocidad medida
 * coincide con la real.
 */
import { createProjector, type Calibration } from "@/lib/homography";
import type { BBox, Detection, Point } from "@/lib/types";

/** Vista tipica desde la banquina: trapecio sobre la mitad inferior del cuadro. */
export const SCENE_CALIBRATION: Calibration = {
  quad: [
    { x: 0.35, y: 0.4 },
    { x: 0.65, y: 0.4 },
    { x: 0.98, y: 0.95 },
    { x: 0.02, y: 0.95 },
  ],
  widthMeters: 7,
  lengthMeters: 30,
};

/** Ancho fisico de un auto, usado para dimensionar la caja con perspectiva real. */
const CAR_WIDTH_M = 1.8;
const CAR_ASPECT = 0.75;

export type SimOptions = {
  calibration?: Calibration;
  /** Velocidad real en m/s (al arrancar, si hay aceleracion). */
  mps: number;
  /** Aceleracion constante en m/s^2. Por defecto 0 (velocidad uniforme). */
  accelMps2?: number;
  /** Carril: coordenada x en metros dentro de la zona. */
  laneX?: number;
  /** Posicion inicial a lo largo de la calzada, en metros (0 = lejos). */
  startY?: number;
  /** Cantidad de frames a simular. */
  frames: number;
  fps?: number;
  /** Timestamp del primer frame, en ms. */
  startT?: number;
  /** Ruido uniforme aplicado a la caja, en unidades normalizadas. */
  jitter?: number;
  /** Generador pseudoaleatorio determinista para el ruido. */
  rng?: () => number;
};

export type SimFrame = { t: number; detections: Detection[]; worldY: number };

/**
 * Genera los frames de un vehiculo acercandose a la camara (y decreciente).
 * La caja se dimensiona proyectando el ancho real del auto, asi que se agranda
 * al acercarse igual que en un video real.
 */
export function simulateApproach(options: SimOptions): SimFrame[] {
  const cal = options.calibration ?? SCENE_CALIBRATION;
  const projector = createProjector(cal);
  if (!projector) throw new Error("calibracion de test invalida");

  const fps = options.fps ?? 25;
  const laneX = options.laneX ?? cal.widthMeters * 0.25;
  const startY = options.startY ?? cal.lengthMeters - 2;
  const startT = options.startT ?? 1000;
  const jitter = options.jitter ?? 0;
  const rng = options.rng ?? mulberry32(42);

  const accel = options.accelMps2 ?? 0;

  const frames: SimFrame[] = [];
  for (let i = 0; i < options.frames; i++) {
    const dt = i / fps;
    // y disminuye: el auto avanza desde el borde cercano hacia el lejano.
    const worldY = startY - (options.mps * dt + 0.5 * accel * dt * dt);
    const t = startT + dt * 1000;

    const bbox = projectCar(projector.toImage, { x: laneX, y: worldY });
    if (!bbox) continue;

    const noisy = jitter
      ? {
          x: bbox.x + (rng() - 0.5) * jitter,
          y: bbox.y + (rng() - 0.5) * jitter,
          w: bbox.w,
          h: bbox.h,
        }
      : bbox;

    frames.push({ t, worldY, detections: [{ label: "car", score: 0.9, bbox: noisy }] });
  }
  return frames;
}

/** Convierte una posicion del mundo en la caja que devolveria el detector. */
export function projectCar(
  toImage: (p: Point) => Point | null,
  world: Point,
): BBox | null {
  const ground = toImage(world);
  const left = toImage({ x: world.x - CAR_WIDTH_M / 2, y: world.y });
  const right = toImage({ x: world.x + CAR_WIDTH_M / 2, y: world.y });
  if (!ground || !left || !right) return null;

  const w = Math.abs(right.x - left.x);
  const h = w * CAR_ASPECT;
  if (!(w > 0)) return null;
  return { x: ground.x - w / 2, y: ground.y - h, w, h };
}

/** PRNG determinista, para que el ruido de los tests sea reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
