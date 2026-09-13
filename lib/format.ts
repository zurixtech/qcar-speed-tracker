/** Formateo de velocidades y etiquetas para la UI. */
import { toKmh, toMph } from "./speed";
import type { SpeedEstimate, Units } from "./types";

export function speedIn(mps: number, units: Units): number {
  return units === "kmh" ? toKmh(mps) : toMph(mps);
}

export function unitLabel(units: Units): string {
  return units === "kmh" ? "km/h" : "mph";
}

export function formatSpeed(mps: number | null, units: Units): string {
  if (mps === null || !Number.isFinite(mps)) return "--";
  return `${Math.round(speedIn(mps, units))}`;
}

/**
 * Por que todavia no hay numero. Sin esto la caja muestra "--" y no hay forma
 * de saber si falta calibrar, si el auto quedo afuera de la zona o si el radar
 * simplemente esta juntando muestras.
 */
const HINTS: Record<NonNullable<SpeedEstimate["reason"]>, string> = {
  "insufficient-samples": "midiendo…",
  "insufficient-time": "midiendo…",
  "no-calibration": "sin escala",
  "outside-zone": "fuera de zona",
  "too-small": "muy lejos",
  implausible: "lectura dudosa",
};

export function speedHint(reason?: SpeedEstimate["reason"]): string {
  return (reason && HINTS[reason]) || "midiendo…";
}

const LABELS: Record<string, string> = {
  car: "Auto",
  truck: "Camion",
  bus: "Colectivo",
  motorcycle: "Moto",
  bicycle: "Bici",
};

export function vehicleLabel(label: string): string {
  return LABELS[label] ?? label;
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
