/**
 * Escala metrica sacada del propio vehiculo, sin calibrar la escena.
 *
 * La homografia de `homography.ts` es mas precisa, pero exige acomodar cuatro
 * esquinas sobre el asfalto y declarar cuantos metros mide ese tramo. Mientras
 * eso no este hecho —o cuando el auto pasa por afuera de la zona— no habia con
 * que convertir pixeles en metros y la caja mostraba "--" para siempre.
 *
 * Aca la referencia es el vehiculo mismo: un auto mide alrededor de 1,8 m de
 * ancho, asi que de la fraccion del cuadro que ocupa su caja sale a que
 * distancia esta. Con esa distancia y el corrimiento lateral se arma una
 * posicion en metros por frame, que es todo lo que la regresion necesita.
 *
 * Es aproximado: depende del ancho supuesto, del angulo desde el que se ve al
 * vehiculo y del campo de vision de la camara. Sirve para tener una lectura
 * desde el primer segundo, no para reemplazar una calibracion hecha; por eso
 * `speed.ts` la usa solo como respaldo y le descuenta calidad.
 */
import type { BBox, Point } from "./types";

/** Ancho real supuesto por clase, en metros (vista de frente o de atras). */
const WIDTHS: Record<string, number> = {
  car: 1.8,
  truck: 2.5,
  bus: 2.55,
  motorcycle: 0.8,
  bicycle: 0.6,
};

const FALLBACK_WIDTH = WIDTHS.car;

/**
 * Campo de vision horizontal por defecto, en grados.
 *
 * El telefono se sostiene en vertical, asi que el ancho del cuadro cae sobre el
 * lado corto del sensor: unos 55 grados en la camara trasera de un movil comun.
 */
export const DEFAULT_FOV_DEG = 55;

/**
 * Cajas mas angostas que esto no sirven: la distancia sale de dividir por el
 * ancho, y con dos o tres pixeles el resultado se va a cualquier lado.
 */
const MIN_BOX_WIDTH = 0.015;

export function vehicleWidthMeters(label: string): number {
  return WIDTHS[label] ?? FALLBACK_WIDTH;
}

/**
 * Distancia focal expresada en anchos de cuadro y no en pixeles: las cajas
 * viajan normalizadas por todo el pipeline, asi la cuenta vale igual para
 * cualquier resolucion. Devuelve null si el angulo no tiene sentido.
 */
export function focalFromFov(fovDeg: number): number | null {
  if (!Number.isFinite(fovDeg) || fovDeg <= 0 || fovDeg >= 180) return null;
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  return tan > 1e-6 ? 0.5 / tan : null;
}

/**
 * Posicion aproximada del vehiculo en metros: `x` cruza la calzada y `y` es la
 * distancia hasta la camara.
 *
 * Solo el eje `y` depende del campo de vision; el lateral se cancela porque el
 * mismo ancho aparente que da la distancia da los metros por pixel a esa
 * distancia.
 */
export function monocularPoint(bbox: BBox, label: string, focal: number): Point | null {
  if (!(bbox.w >= MIN_BOX_WIDTH) || !Number.isFinite(focal)) return null;
  // Metros por unidad de ancho de cuadro, a la profundidad de este vehiculo.
  const scale = vehicleWidthMeters(label) / bbox.w;
  const offset = bbox.x + bbox.w / 2 - 0.5;
  return { x: offset * scale, y: focal * scale };
}
