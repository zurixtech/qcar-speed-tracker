/** Dibujo del overlay del radar sobre un canvas 2D. */
import type { Calibration } from "./homography";
import { formatSpeed, unitLabel, vehicleLabel } from "./format";
import type { TrackedVehicle, Units } from "./types";

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
};

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: DrawOptions,
): void {
  ctx.clearRect(0, 0, width, height);
  if (width === 0 || height === 0) return;

  if (opts.showZone) drawZone(ctx, width, height, opts);
  for (const v of opts.vehicles) drawVehicle(ctx, width, height, v, opts);
}

function drawZone(ctx: CanvasRenderingContext2D, w: number, h: number, opts: DrawOptions): void {
  const quad = opts.calibration.quad;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(quad[0].x * w, quad[0].y * h);
  for (let i = 1; i < quad.length; i++) ctx.lineTo(quad[i].x * w, quad[i].y * h);
  ctx.closePath();

  ctx.fillStyle = opts.calibrationValid ? "rgba(56,189,248,0.10)" : "rgba(239,68,68,0.12)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = opts.calibrationValid ? COLOR_ZONE : COLOR_ALERT;
  ctx.stroke();
  ctx.restore();
}

function drawVehicle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  v: TrackedVehicle,
  opts: DrawOptions,
): void {
  const x = v.bbox.x * w;
  const y = v.bbox.y * h;
  const bw = v.bbox.w * w;
  const bh = v.bbox.h * h;

  const color = v.speeding ? COLOR_ALERT : v.mps === null ? COLOR_PENDING : COLOR_OK;

  if (opts.showTrails && v.trail.length > 1) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(v.trail[0].x * w, v.trail[0].y * h);
    for (let i = 1; i < v.trail.length; i++) ctx.lineTo(v.trail[i].x * w, v.trail[i].y * h);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.lineWidth = v.speeding ? 4 : 2.5;
  ctx.strokeStyle = color;
  ctx.strokeRect(x, y, bw, bh);

  if (v.speeding) {
    ctx.fillStyle = "rgba(239,68,68,0.16)";
    ctx.fillRect(x, y, bw, bh);
  }

  const speed = formatSpeed(v.mps, opts.units);
  const text =
    v.mps === null
      ? `${vehicleLabel(v.label)} · midiendo…`
      : `${vehicleLabel(v.label)} · ${speed} ${unitLabel(opts.units)}`;

  const fontSize = Math.max(12, Math.min(20, w * 0.018));
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  const padding = fontSize * 0.4;
  const textWidth = ctx.measureText(text).width;
  const boxH = fontSize + padding * 2;
  // Si la caja toca el borde superior, la etiqueta va adentro.
  const labelY = y - boxH < 0 ? y : y - boxH;

  ctx.fillStyle = color;
  ctx.fillRect(x, labelY, textWidth + padding * 2, boxH);
  ctx.fillStyle = v.speeding ? "#fff" : "#0b1220";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padding, labelY + boxH / 2);
  ctx.restore();
}
