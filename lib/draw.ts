/** Dibujo del overlay del radar sobre un canvas 2D. */
import type { Calibration } from "./homography";
import { formatSpeed, speedHint, unitLabel, vehicleLabel } from "./format";
import type { TrackedVehicle, Units } from "./types";
import { toView, type ViewRect } from "./view";

const COLOR_OK = "#22c55e";
const COLOR_ALERT = "#ef4444";
const COLOR_PENDING = "#facc15";
const COLOR_ZONE = "#38bdf8";

export type DrawOptions = {
  vehicles: readonly TrackedVehicle[];
  calibration: Calibration;
  units: Units;
  showZone: boolean;
  showTrails: boolean;
  /** true si la calibracion actual produce una homografia utilizable. */
  calibrationValid: boolean;
  /** Rectangulo que ocupa el frame dentro del canvas (por las bandas negras). */
  view: ViewRect;
};

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: DrawOptions,
): void {
  ctx.clearRect(0, 0, width, height);
  if (width === 0 || height === 0) return;

  if (opts.showZone) drawZone(ctx, opts);
  for (const v of opts.vehicles) drawVehicle(ctx, v, opts);
}

function drawZone(ctx: CanvasRenderingContext2D, opts: DrawOptions): void {
  const quad = opts.calibration.quad;
  ctx.save();
  ctx.beginPath();
  const first = toView(opts.view, quad[0].x, quad[0].y);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < quad.length; i++) {
    const p = toView(opts.view, quad[i].x, quad[i].y);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();

  ctx.fillStyle = opts.calibrationValid ? "rgba(56,189,248,0.10)" : "rgba(239,68,68,0.12)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = opts.calibrationValid ? COLOR_ZONE : COLOR_ALERT;
  ctx.stroke();
  ctx.restore();
}

function drawVehicle(ctx: CanvasRenderingContext2D, v: TrackedVehicle, opts: DrawOptions): void {
  const view = opts.view;
  const topLeft = toView(view, v.bbox.x, v.bbox.y);
  const x = topLeft.x;
  const y = topLeft.y;
  const bw = v.bbox.w * view.w;
  const bh = v.bbox.h * view.h;

  const color = v.speeding ? COLOR_ALERT : v.mps === null ? COLOR_PENDING : COLOR_OK;

  if (opts.showTrails && v.trail.length > 1) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const start = toView(view, v.trail[0].x, v.trail[0].y);
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < v.trail.length; i++) {
      const p = toView(view, v.trail[i].x, v.trail[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.lineWidth = v.speeding ? 4 : 3;
  ctx.strokeStyle = color;
  ctx.strokeRect(x, y, bw, bh);

  if (v.speeding) {
    ctx.fillStyle = "rgba(239,68,68,0.16)";
    ctx.fillRect(x, y, bw, bh);
  }

  drawSpeedInBox(ctx, { x, y, w: bw, h: bh }, v, color, opts);
  ctx.restore();
}

/**
 * La velocidad va ADENTRO del recuadro, grande y centrada: en un celular
 * sostenido a un brazo de distancia, una etiqueta chica arriba de la caja no se
 * lee, y encima se corta cuando el auto toca el borde de arriba del cuadro.
 */
function drawSpeedInBox(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  v: TrackedVehicle,
  color: string,
  opts: DrawOptions,
): void {
  const measured = v.mps !== null;
  // La escala automatica sale de suponer el ancho del vehiculo: el numero es un
  // orden de magnitud, no una medicion, y tiene que verse la diferencia.
  const approx = measured && v.source === "auto";
  const value = measured ? `${approx ? "~" : ""}${formatSpeed(v.mps, opts.units)}` : "--";
  const unit = unitLabel(opts.units);

  // El tamano sale de la caja pero acotado al canvas: un auto lejano no puede
  // dejar un numero ilegible, y uno cercano no puede taparse entero.
  const canvasCap = Math.min(opts.view.w, opts.view.h) * 0.12;
  const full = clamp(Math.min(box.w * 0.34, box.h * 0.42), 16, Math.max(18, canvasCap));
  // Mientras no hay lectura el cartel se achica: todavia no dice nada y no
  // tiene por que tapar al vehiculo ni al auto de al lado.
  const size = measured ? full : full * 0.62;

  ctx.font = `800 ${size}px system-ui, -apple-system, sans-serif`;
  const valueWidth = ctx.measureText(value).width;
  const unitSize = size * 0.42;
  ctx.font = `700 ${unitSize}px system-ui, -apple-system, sans-serif`;
  const unitWidth = ctx.measureText(unit).width;

  const padX = size * 0.32;
  const padY = size * 0.22;
  const gap = size * 0.18;
  const plateW = valueWidth + gap + unitWidth + padX * 2;
  const plateH = size + padY * 2;

  // Centrado en la caja, pero sin salirse del cuadro visible.
  const cx = box.x + box.w / 2;
  const plateX = clamp(cx - plateW / 2, opts.view.x + 2, opts.view.x + opts.view.w - plateW - 2);
  const plateY = clamp(
    box.y + box.h / 2 - plateH / 2,
    opts.view.y + 2,
    opts.view.y + opts.view.h - plateH - 2,
  );

  ctx.save();
  roundRect(ctx, plateX, plateY, plateW, plateH, plateH * 0.28);
  ctx.fillStyle = measured ? "rgba(3,7,18,0.72)" : "rgba(3,7,18,0.55)";
  ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.strokeStyle = color;
  ctx.stroke();

  ctx.textBaseline = "alphabetic";
  const baseline = plateY + padY + size * 0.78;
  ctx.fillStyle = measured ? "#ffffff" : "rgba(255,255,255,0.7)";
  ctx.font = `800 ${size}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(value, plateX + padX, baseline);

  ctx.fillStyle = color;
  ctx.font = `700 ${unitSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(unit, plateX + padX + valueWidth + gap, baseline);
  ctx.restore();

  // Mientras no hay lectura, decir por que: "--" a secas se lee como que la app
  // no anda, cuando lo que suele faltar es acomodar la zona o acercarse.
  if (!measured) drawHint(ctx, speedHint(v.reason), plateX + plateW / 2, plateY + plateH, size, opts);

  // El tipo de vehiculo queda como etiqueta chica pegada al borde de la caja.
  const tagSize = clamp(size * 0.38, 10, 16);
  const tag = vehicleLabel(v.label);
  ctx.save();
  ctx.font = `600 ${tagSize}px system-ui, -apple-system, sans-serif`;
  const tagW = ctx.measureText(tag).width + tagSize * 0.8;
  const tagH = tagSize * 1.7;
  const tagY = box.y - tagH < opts.view.y ? box.y : box.y - tagH;
  ctx.fillStyle = color;
  ctx.fillRect(box.x, tagY, tagW, tagH);
  ctx.fillStyle = v.speeding ? "#ffffff" : "#0b1220";
  ctx.textBaseline = "middle";
  ctx.fillText(tag, box.x + tagSize * 0.4, tagY + tagH / 2);
  ctx.restore();
}

/** Cartelito con el motivo, centrado justo debajo de la chapa de velocidad. */
function drawHint(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  top: number,
  size: number,
  opts: DrawOptions,
): void {
  const fontSize = clamp(size * 0.46, 9, 14);
  ctx.save();
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  const w = ctx.measureText(text).width + fontSize * 1.2;
  const h = fontSize * 1.9;
  const x = clamp(centerX - w / 2, opts.view.x + 2, opts.view.x + opts.view.w - w - 2);
  // Si no entra abajo, el cartel se acomoda arriba de la chapa.
  const fits = top + fontSize * 0.4 + h <= opts.view.y + opts.view.h - 2;
  const y = fits ? top + fontSize * 0.4 : top - h - fontSize * 1.4;

  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(3,7,18,0.7)";
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
