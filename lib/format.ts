/** Formateo de velocidades y etiquetas para la UI. */
import { toKmh, toMph } from "./speed";
import type { Units } from "./types";

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
