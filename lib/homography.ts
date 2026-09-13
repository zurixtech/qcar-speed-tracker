/**
 * Homografia plana: convierte puntos de la imagen (normalizados 0..1) a
 * coordenadas del mundo real sobre el plano de la calzada (metros).
 *
 * Se usa el algoritmo DLT clasico con 4 correspondencias, fijando h33 = 1.
 * Los puntos de imagen se guardan normalizados para que la calibracion sea
 * independiente de la resolucion del video o del tamano del canvas.
 */
import { Matrix, solve } from "ml-matrix";
import type { Point } from "./types";

/** Matriz 3x3 en row-major. */
export type Homography = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export type Quad = readonly [Point, Point, Point, Point];

/**
 * Calibracion de la escena: un cuadrilatero sobre la calzada y sus medidas
 * reales. El orden de los puntos es:
 *   0 = lejos-izquierda, 1 = lejos-derecha, 2 = cerca-derecha, 3 = cerca-izquierda
 * Es decir, en sentido horario arrancando por la esquina mas lejana izquierda.
 */
export type Calibration = {
  /** Esquinas en coordenadas normalizadas de la imagen (0..1). */
  quad: Quad;
  /** Ancho real de la zona (perpendicular a la marcha), en metros. */
  widthMeters: number;
  /** Largo real de la zona (a lo largo de la marcha), en metros. */
  lengthMeters: number;
};

const EPS = 1e-9;

/**
 * Rectangulo del mundo asociado a una calibracion. El origen (0,0) queda en la
 * esquina lejana izquierda; +x cruza la calzada, +y avanza hacia la camara.
 */
export function worldQuad(cal: Pick<Calibration, "widthMeters" | "lengthMeters">): Quad {
  const w = cal.widthMeters;
  const l = cal.lengthMeters;
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: l },
    { x: 0, y: l },
  ];
}

/**
 * Calcula la homografia que mapea `src` -> `dst`.
 * Devuelve null si el sistema es degenerado (puntos colineales o repetidos).
 */
export function computeHomography(src: Quad, dst: Quad): Homography | null {
  const a: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  try {
    const solution = solve(new Matrix(a), Matrix.columnVector(b));
    const h = solution.to1DArray();
    if (h.length !== 8 || h.some((n) => !Number.isFinite(n))) return null;
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] as Homography;
  } catch {
    return null;
  }
}

/** Aplica la homografia a un punto. Devuelve null si cae sobre/detras del horizonte. */
export function applyHomography(h: Homography, p: Point): Point | null {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (!Number.isFinite(w) || Math.abs(w) < EPS) return null;
  const x = (h[0] * p.x + h[1] * p.y + h[2]) / w;
  const y = (h[3] * p.x + h[4] * p.y + h[5]) / w;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** Area con signo del poligono (positiva en sentido antihorario con y hacia arriba). */
export function signedArea(poly: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/**
 * Un cuadrilatero es utilizable si es convexo y tiene area suficiente.
 * Un quad autointersectado o casi degenerado produce velocidades absurdas.
 */
export function isUsableQuad(quad: Quad, minArea = 1e-3): boolean {
  if (quad.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  if (Math.abs(signedArea(quad)) < minArea) return false;

  let positive = 0;
  let negative = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross > EPS) positive++;
    else if (cross < -EPS) negative++;
  }
  // Convexo = todos los productos cruzados con el mismo signo.
  return positive === 0 || negative === 0;
}

/** Test punto-en-poligono (ray casting). Los bordes cuentan como dentro. */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || EPS) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Proyector listo para usar, derivado de una calibracion. */
export type Projector = {
  /** Proyecta un punto normalizado de imagen a metros sobre la calzada. */
  toWorld(p: Point): Point | null;
  /** Indica si el punto normalizado cae dentro de la zona calibrada. */
  inZone(p: Point): boolean;
  /** Proyecta de metros de vuelta a coordenadas normalizadas de imagen. */
  toImage(p: Point): Point | null;
};

/** Construye un proyector. Devuelve null si la calibracion no es valida. */
export function createProjector(cal: Calibration): Projector | null {
  if (!(cal.widthMeters > 0) || !(cal.lengthMeters > 0)) return null;
  if (!isUsableQuad(cal.quad)) return null;

  const dst = worldQuad(cal);
  const h = computeHomography(cal.quad, dst);
  if (!h) return null;
  const inv = computeHomography(dst, cal.quad);

  return {
    toWorld: (p) => applyHomography(h, p),
    inZone: (p) => pointInPolygon(p, cal.quad),
    toImage: (p) => (inv ? applyHomography(inv, p) : null),
  };
}
