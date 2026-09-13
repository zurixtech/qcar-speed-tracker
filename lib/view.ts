/**
 * Geometria de la vista: donde cae realmente el frame del video dentro del
 * elemento que lo muestra.
 *
 * El pipeline trabaja en coordenadas normalizadas del FRAME (0..1), pero el
 * video se dibuja con `object-contain`: si el frame y el contenedor no tienen
 * la misma relacion de aspecto quedan bandas negras. En el celular eso es la
 * regla, no la excepcion (camara 16:9 dentro de una pantalla 9:19). Sin esta
 * correccion los recuadros se dibujan corridos respecto del auto.
 */
export type ViewRect = { x: number; y: number; w: number; h: number };

/** Rectangulo que ocupa el frame dentro del contenedor, al estilo `object-contain`. */
export function containRect(
  containerW: number,
  containerH: number,
  srcW: number,
  srcH: number,
): ViewRect {
  const full = { x: 0, y: 0, w: containerW, h: containerH };
  if (!(containerW > 0) || !(containerH > 0) || !(srcW > 0) || !(srcH > 0)) return full;

  const scale = Math.min(containerW / srcW, containerH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (containerW - w) / 2, y: (containerH - h) / 2, w, h };
}

/** Pasa un punto normalizado del frame a coordenadas del contenedor. */
export function toView(view: ViewRect, nx: number, ny: number): { x: number; y: number } {
  return { x: view.x + nx * view.w, y: view.y + ny * view.h };
}

/** Inversa de `toView`: de coordenadas del contenedor al frame normalizado. */
export function fromView(view: ViewRect, x: number, y: number): { x: number; y: number } {
  if (!(view.w > 0) || !(view.h > 0)) return { x: 0, y: 0 };
  return { x: clamp01((x - view.x) / view.w), y: clamp01((y - view.y) / view.h) };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
